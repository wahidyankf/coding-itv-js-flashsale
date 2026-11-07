// A Server-Sent Events reader built on fetch, for the sale's two live streams. The browser's EventSource cannot send a
// header, and the queue ticket travels in one, so the page reads the stream itself. The same code runs in the browser
// and in tests.
import { attempt, attemptAsync } from "@flash/typekit";
import { STATUS } from "../api";

// Starts reading a stream and calls `onEvent` for each event. Returns a way to stop it.
export type Watcher = (
	url: string,
	onEvent: (event: string, data: unknown) => void,
	headers?: Record<string, string>,
) => () => void;

// How a watcher behaves: the fetch it uses, and how long it waits before it reconnects.
export type WatchOptions = {
	fetcher?: typeof fetch;
	// How long to wait before opening the stream again after it ended or failed.
	retryMs?: number;
};

const DEFAULT_RETRY_MS = 1000;

type Frame = { event: string; data: unknown };
type Listener = (event: string, data: unknown) => void;
// `refused`: asking again would get the same answer, so the watcher stops. `closed`: the stream ended, and may reopen.
type Ending = "refused" | "closed";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// One connection: asks for the stream, and reads it when the server accepts it.
async function connectOnce(
	fetcher: typeof fetch,
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
	onEvent: Listener,
): Promise<Ending> {
	const reply = await fetcher(url, { headers, signal });
	if (
		reply.status === STATUS.unauthorized ||
		reply.status === STATUS.notFound
	) {
		return "refused";
	}
	if (reply.ok && reply.body) await readFrames(reply.body, onEvent);
	return "closed";
}

// The watcher keeps a stream open until it is stopped. A stream that fails or closes is opened again after `retryMs`,
// unless the server refused it.
export function createWatcher(options: WatchOptions = {}): Watcher {
	const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
	return (url, onEvent, headers = {}) => {
		const controller = new AbortController();
		const fetcher = options.fetcher ?? fetch;

		const run = async (): Promise<void> => {
			while (!controller.signal.aborted) {
				// A failure means the connection failed. The loop opens it again unless the watcher was stopped.
				const ended = await attemptAsync(
					() => connectOnce(fetcher, url, headers, controller.signal, onEvent),
					Error,
				);
				if (ended.isOk() && ended.value === "refused") return;
				if (!controller.signal.aborted) await sleep(retryMs);
			}
		};

		void run();
		return () => controller.abort();
	};
}
