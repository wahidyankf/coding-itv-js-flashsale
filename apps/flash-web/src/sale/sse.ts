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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Splits the text that arrived so far into complete frames. Returns the frames and the rest.
export function readFrames(buffer: string): {
	frames: Array<{ event: string; data: unknown }>;
	rest: string;
} {
	const frames: Array<{ event: string; data: unknown }> = [];
	let rest = buffer;
	for (let end = rest.indexOf("\n\n"); end >= 0; end = rest.indexOf("\n\n")) {
		const frame = rest.slice(0, end);
		rest = rest.slice(end + 2);
		// A line that starts with a colon is a keep-alive comment.
		if (frame.startsWith(":")) continue;
		const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
		const data = /^data: (.*)$/m.exec(frame)?.[1];
		if (data !== undefined) frames.push({ event, data: JSON.parse(data) });
	}
	return { frames, rest };
}

export function createWatcher(options: WatchOptions = {}): Watcher {
	const retryMs = options.retryMs ?? 1000;
	return (url, onEvent, headers = {}) => {
		const controller = new AbortController();
		const fetcher = options.fetcher ?? fetch;

		const run = async (): Promise<void> => {
			while (!controller.signal.aborted) {
				try {
					const reply = await fetcher(url, {
						headers,
						signal: controller.signal,
					});
					// A refusal will not change by asking again.
					if (reply.status === 401 || reply.status === 404) return;
					if (reply.ok && reply.body) {
						const reader = reply.body.getReader();
						const decoder = new TextDecoder();
						let buffer = "";
						for (;;) {
							const chunk = await reader.read();
							if (chunk.done) break;
							buffer += decoder.decode(chunk.value, { stream: true });
							const { frames, rest } = readFrames(buffer);
							buffer = rest;
							for (const frame of frames) onEvent(frame.event, frame.data);
						}
					}
				} catch {
					// The connection failed or was closed. The loop opens it again unless the watcher was stopped.
				}
				if (!controller.signal.aborted) await sleep(retryMs);
			}
		};

		void run();
		return () => controller.abort();
	};
}
