// Browser only, part of the sale feature. Reads the sale's two live streams with fetch, since EventSource cannot send the queue ticket header.
// Failed connections retry with exponential backoff and full jitter. Decisions: docs/explanation/decisions/008-server-sent-events.md and docs/explanation/decisions/017-retry-backoff-jitter.md.
import {
	backoffDelayMs,
	HTTP_STATUS,
	MS_PER_SECOND,
	type RetryPolicy,
	retryAsync,
} from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { attempt, attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { decodeRefusal, readBody } from "../api";

// What one subscription asks for: its headers, and a call when the watcher has given up on it.
export type Subscription = {
	headers?: Record<string, string>;
	// Called once when the watcher stops for good without being stopped: after the last attempt failed, or at once when the
	// stream is refused (a gone sale, a wrong ticket). It is not called when the login is lost, because the page shows that.
	onGiveUp?: () => void;
};

// Starts reading a stream and calls `onEvent` for each event. `onEvent` returns true when it used the event, and false when
// it dropped it (for example, a frame that does not decode). Only a used frame shows that the stream is alive. Returns a
// way to stop it.
export type Watcher = (
	url: string,
	onEvent: (event: string, data: unknown) => boolean,
	subscription?: Subscription,
) => () => void;

// How a watcher behaves: the fetch it uses, and how it waits between attempts. The sleep and the random source are
// injected, so a test runs without the real clock.
export type WatchOptions = {
	fetcher?: typeof fetch;
	// The backoff and the attempt count of one outage. A stream that delivers a frame starts the count again.
	policy?: RetryPolicy;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
};

// The live streams wait about a second before the first retry, double the wait up to 30 seconds, and give up after 8
// failed attempts in a row. A page that keeps failing is told to reload, rather than retrying forever.
const LIVE_BASE_MS = MS_PER_SECOND;
const LIVE_CAP_SECONDS = 30;
const LIVE_MAX_ATTEMPTS = 8;
const LIVE_POLICY: RetryPolicy = {
	baseMs: LIVE_BASE_MS,
	capMs: LIVE_CAP_SECONDS * MS_PER_SECOND,
	maxAttempts: LIVE_MAX_ATTEMPTS,
};

type Frame = { event: string; data: unknown };
type Listener = (event: string, data: unknown) => boolean;
// `refused`: asking again would get the same answer, so the watcher stops and says so. `login-lost`: the renewing fetch could
// not renew the login and has told the page already, so the watcher stops and says nothing. `failed`: no frame came, so
// the try counts.
type Failure = "refused" | "login-lost" | "failed";

// Splits the text that arrived so far into complete frames. Returns the frames and the rest. A keep-alive comment and a
// frame whose data is not JSON are skipped.
export function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
	const frames: Frame[] = [];
	let rest = buffer;
	for (let end = rest.indexOf("\n\n"); end >= 0; end = rest.indexOf("\n\n")) {
		const text = rest.slice(0, end);
		rest = rest.slice(end + 2);
		if (text.startsWith(":")) continue;
		const event = /^event: (.*)$/m.exec(text)?.[1] ?? "message";
		const line = /^data: (.*)$/m.exec(text)?.[1];
		if (line === undefined) continue;
		const data = attempt(() => JSON.parse(line) as unknown, SyntaxError);
		if (data.isOk()) frames.push({ event, data: data.value });
	}
	return { frames, rest };
}

// Reads an open stream until it ends, and hands each complete frame to the listener. A frame can be split between two
// chunks, so the text is kept until its blank line arrives.
async function readFrames(
	body: NonNullable<Response["body"]>,
	onEvent: Listener,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) return;
		buffer += decoder.decode(chunk.value, { stream: true });
		const { frames, rest } = parseFrames(buffer);
		buffer = rest;
		for (const frame of frames) onEvent(frame.event, frame.data);
	}
}

// Whether a 401 says the login is gone. The fetch the watcher is given renews the login once on such a reply, so one that
// reaches the watcher is a login the refresh token could not restore. Any other 401, such as a wrong ticket, is a refusal.
async function isLoginLost(response: Response): Promise<boolean> {
	if (response.status !== HTTP_STATUS.unauthorized) return false;
	const text = await attemptAsync(() => response.text(), Error);
	if (text.isErr()) return false;
	const refusal = readBody(text.value, decodeRefusal);
	return refusal.isOk() && refusal.value.errorCode === "not_authenticated";
}

// One connection. A refusal (401, 404) is Err "refused", or "login-lost" for a login that could not be renewed. A stream
// that gave a used frame is Ok, even if it then ends or breaks. Anything else is Err "failed", so a stream the page
// cannot read still gives up.
async function connectOnce(
	fetcher: typeof fetch,
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
	onEvent: Listener,
): Promise<Result<void, Failure>> {
	const reply = await attemptAsync(
		() => fetcher(url, { headers, signal }),
		Error,
	);
	if (reply.isErr()) return new Err("failed");
	const response = reply.value;
	if (await isLoginLost(response)) return new Err("login-lost");
	if (
		response.status === HTTP_STATUS.unauthorized ||
		response.status === HTTP_STATUS.notFound
	) {
		return new Err("refused");
	}
	if (!response.ok) return new Err("failed");
	const body = response.body;
	const received = { frame: false };
	const onFrame: Listener = (event, data) => {
		const used = onEvent(event, data);
		if (used) received.frame = true;
		return used;
	};
	// A drop mid-stream is not reported: whether a frame came is what decides the try. The error is not needed.
	if (body) await attemptAsync(() => readFrames(body, onFrame), Error);
	return received.frame ? new Ok(undefined) : new Err("failed");
}

// Keeps a stream open until it is stopped. An outage gets up to `maxAttempts` tries, with jittered backoff between them.
// A try that gave a used frame starts a new count. A try with no used frame is a failure, so a server that keeps
// closing the stream still gives up. A refusal stops at once and is reported, so the page does not keep old words; a lost
// login stops at once and is left to the page.
export function createWatcher(options: WatchOptions = {}): Watcher {
	const policy = options.policy ?? LIVE_POLICY;
	const wait = options.sleep ?? sleep;
	const random = options.random ?? Math.random;
	return (url, onEvent, subscription = {}) => {
		const controller = new AbortController();
		const fetcher = options.fetcher ?? fetch;
		const headers = subscription.headers ?? {};

		const run = async (): Promise<void> => {
			while (!controller.signal.aborted) {
				const outcome = await retryAsync(
					() => connectOnce(fetcher, url, headers, controller.signal, onEvent),
					{
						...policy,
						shouldRetry: (failure) => failure === "failed",
						sleep: wait,
						random,
						signal: controller.signal,
					},
				);
				if (controller.signal.aborted) return;
				if (outcome.isOk()) {
					// The stream gave frames and then ended, so open it again after a short wait.
					await wait(backoffDelayMs(0, policy, random));
					continue;
				}
				if (outcome.error !== "login-lost") subscription.onGiveUp?.();
				return;
			}
		};

		void run();
		return () => controller.abort();
	};
}
