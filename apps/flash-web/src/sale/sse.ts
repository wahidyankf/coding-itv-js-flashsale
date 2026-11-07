// A Server-Sent Events reader built on fetch, for the sale's two live streams. The browser's EventSource cannot send a
// header, and the queue ticket travels in one, so the page reads the stream itself. The same code runs in the browser
// and in tests. A failed connection is retried with exponential backoff and full jitter, through @flash/flash-commons.
// Decision: docs/explanation/decisions/008-server-sent-events.md (why the streams are read this way).
// Decision: docs/explanation/decisions/017-retry-backoff-jitter.md (why every outage has a max attempt count).
import {
	backoffDelayMs,
	HTTP_STATUS,
	MS_PER_SECOND,
	type RetryPolicy,
	retryAsync,
} from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { attempt, attemptAsync, Err, Ok, type Result } from "@flash/typekit";

// What one subscription asks for: its headers, and a call when the watcher has given up on it.
export type Subscription = {
	headers?: Record<string, string>;
	// Called once, after the last attempt failed. A refused stream does not call it, because it is not retried at all.
	onGiveUp?: () => void;
};

// Starts reading a stream and calls `onEvent` for each event. Returns a way to stop it.
export type Watcher = (
	url: string,
	onEvent: (event: string, data: unknown) => void,
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
type Listener = (event: string, data: unknown) => void;
// `refused`: asking again would get the same answer, so the watcher stops. `failed`: no frame came, so the try counts.
type Failure = "refused" | "failed";

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

// One connection: asks for the stream. A refusal (401, 404) is Err "refused". Any other failure, and a stream that ends
// or breaks before it delivered a frame, is Err "failed". A stream that delivered a frame is Ok, whether it then ends or
// breaks. A keep-alive is not a frame: flash-be sends the first event on connect, so a stream that carries none is not
// healthy, and it must not reset the count.
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
		received.frame = true;
		onEvent(event, data);
	};
	// A drop mid-stream is not reported: whether a frame came is what decides the try. The error is not needed.
	if (body) await attemptAsync(() => readFrames(body, onFrame), Error);
	return received.frame ? new Ok(undefined) : new Err("failed");
}

// The watcher keeps a stream open until it is stopped. Each outage gets up to `maxAttempts` tries, waiting a jittered
// backoff between them. A try that delivers a frame starts a fresh count after a short wait. A try that ends or breaks
// with no frame is a failure, so a server that keeps accepting and closing still reaches the give-up. When the last try
// of an outage fails, the watcher stops and tells the subscription. A refusal stops it at once.
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
					// The stream delivered frames and then ended. It is opened again after a short wait, counting from the first attempt.
					await wait(backoffDelayMs(0, policy, random));
					continue;
				}
				if (outcome.error === "failed") subscription.onGiveUp?.();
				return;
			}
		};

		void run();
		return () => controller.abort();
	};
}
