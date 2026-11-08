// Server-Sent Events for the HTTP adapter: a loop that reads the state every interval and writes an event to the client
// only when the state changed. It belongs to the inbound layer, so it knows about the HTTP reply and nothing of the rules.

import { HTTP_STATUS } from "@flash/flash-commons";
import { attemptAsync } from "@flash/typekit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REQUEST_ID_HEADER } from "./headers.js";

// SSE clients skip lines that start with a colon, so this keeps the connection alive without an event.
const KEEP_ALIVE_FRAME = ": keep-alive\n\n";

// How often the stream reads, and how often it sends a keep-alive. main.ts sets the read interval from the config; the
// heartbeat keeps its default.
export type StreamOptions = {
	// How often the source is read.
	intervalMs: number;
	// A comment line is sent when nothing else was, so proxies do not close an idle connection.
	heartbeatMs: number;
};

// The streams that are open now. The app ends each one when it closes, so a stream never holds a stopping server open
// and its client reconnects, with its own backoff, to an instance that is still running.
export type OpenStreams = {
	// Records a stream by the function that ends it. Returns the function that forgets it, for a client that left. Once
	// endAll ran, a new stream is ended at once: a reconnect on a kept-alive connection must not hold the close open.
	add: (end: () => void) => () => void;
	// Ends every stream that is still open, and every stream added after it.
	endAll: () => void;
};

// What a route hands to serveEvents: the pacing, and the open streams the stream joins.
export type StreamContext = StreamOptions & { open: OpenStreams };

// A new, empty set of open streams. Each app has its own.
export function createOpenStreams(): OpenStreams {
	const ends = new Set<() => void>();
	let ended = false;
	return {
		add: (end) => {
			if (ended) {
				end();
				return () => {};
			}
			ends.add(end);
			return () => ends.delete(end);
		},
		endAll: () => {
			ended = true;
			for (const end of [...ends]) end();
		},
	};
}

// One thing to tell the client. `data` is sent as JSON and compared with the last one, so an unchanged state is
// not repeated.
export type StreamItem = { event: string; data: unknown };

// Pacing for when the configuration does not set it. Keep-alives come less often than reads, since they only stop idle timeouts.
export const DEFAULT_STREAM_OPTIONS: StreamOptions = {
	intervalMs: 1000,
	heartbeatMs: 15_000,
};

// Writes one event in the SSE wire format. The blank line at the end tells the client the event is complete.
export function formatEvent(item: StreamItem): string {
	return `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`;
}

// Streams what `read` returns to the client, once per interval, and only when it changed, until the client leaves or the
// app closes and ends it through `options.open`. Callers check the request
// first: once the reply is hijacked, an error cannot be sent as a JSON reply.
export function serveEvents(
	request: FastifyRequest,
	reply: FastifyReply,
	read: () => Promise<StreamItem | undefined>,
	options: StreamContext,
	log: (error: unknown) => void,
): void {
	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(HTTP_STATUS.ok, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		// Tells nginx not to buffer the stream.
		"x-accel-buffering": "no",
		// A hijacked reply skips the hooks, so the stream names its request here.
		[REQUEST_ID_HEADER]: request.id,
	});

	let closed = false;
	let last: string | undefined;
	let lastWrite = Date.now();
	let timer: NodeJS.Timeout | undefined;

	const tick = async (): Promise<void> => {
		const sent = await attemptAsync(async () => {
			const item = await read();
			// Nothing to tell: no event and no keep-alive. The next interval asks again. A stream that ended during the
			// read is not written to again.
			if (item === undefined || closed) return;
			const key = JSON.stringify(item);
			if (key !== last) {
				last = key;
				raw.write(formatEvent(item));
				lastWrite = Date.now();
			} else if (Date.now() - lastWrite >= options.heartbeatMs) {
				raw.write(KEEP_ALIVE_FRAME);
				lastWrite = Date.now();
			}
		}, Error);
		// A failed read is skipped. The next interval tries again.
		if (sent.isErr()) log(sent.error);
		if (!closed) timer = setTimeout(tick, options.intervalMs);
	};

	const stop = (): void => {
		closed = true;
		clearTimeout(timer);
	};
	const forget = options.open.add(() => {
		stop();
		raw.end();
	});
	request.raw.on("close", () => {
		stop();
		forget();
	});
	// A stream the app ended as it was added is not read at all.
	if (!closed) void tick();
}
