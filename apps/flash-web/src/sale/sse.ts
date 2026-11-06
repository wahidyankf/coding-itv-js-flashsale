import { attempt, attemptAsync } from "@flash/typekit";
import { STATUS } from "../api";

// A Server-Sent Events reader built on fetch. The browser's EventSource cannot send a header, and the queue ticket
// travels in one. The same code runs in the browser and in tests.
export type Watcher = (
	url: string,
	onEvent: (event: string, data: unknown) => void,
	headers?: Record<string, string>,
) => () => void;

export type WatchOptions = {
	fetcher?: typeof fetch;
	// How long to wait before opening the stream again after it ended or failed.
	retryMs?: number;
};

const DEFAULT_RETRY_MS = 1000;

type Frame = { event: string; data: unknown };

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

export function createWatcher(options: WatchOptions = {}): Watcher {
	const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
	return (url, onEvent, headers = {}) => {
		const controller = new AbortController();
		const fetcher = options.fetcher ?? fetch;

		const run = async (): Promise<void> => {
			while (!controller.signal.aborted) {
				// A failure means the connection failed or was closed. The loop opens it again unless the watcher was stopped.
				const finished = await attemptAsync(
					async (): Promise<"refused" | "closed"> => {
						const reply = await fetcher(url, {
							headers,
							signal: controller.signal,
						});
						// A refusal will not change by asking again.
						if (
							reply.status === STATUS.unauthorized ||
							reply.status === STATUS.notFound
						) {
							return "refused";
						}
						if (reply.ok && reply.body) {
							const reader = reply.body.getReader();
							const decoder = new TextDecoder();
							let buffer = "";
							for (;;) {
								const chunk = await reader.read();
								if (chunk.done) break;
								buffer += decoder.decode(chunk.value, { stream: true });
								const { frames, rest } = parseFrames(buffer);
								buffer = rest;
								for (const frame of frames) onEvent(frame.event, frame.data);
							}
						}
						return "closed";
					},
					Error,
				);
				if (finished.isOk() && finished.value === "refused") return;
				if (!controller.signal.aborted) await sleep(retryMs);
			}
		};

		void run();
		return () => controller.abort();
	};
}
