// Server-Sent Events for the HTTP adapter: a loop that reads the state every interval and writes an event to the client
// only when the state changed. It belongs to the inbound layer, so it knows about the HTTP reply and nothing of the rules.

import { HTTP_STATUS } from "@flash/flash-commons";
import { attemptAsync } from "@flash/typekit";
import type { FastifyReply, FastifyRequest } from "fastify";

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

// Streams what `read` returns to the client, once per interval, and only when it changed. Callers check the request
// first: once the reply is hijacked, an error cannot be sent as a JSON reply.
export function serveEvents(
	request: FastifyRequest,
	reply: FastifyReply,
	read: () => Promise<StreamItem | undefined>,
	options: StreamOptions,
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
	});

	let closed = false;
	let last: string | undefined;
	let lastWrite = Date.now();
	let timer: NodeJS.Timeout | undefined;

	const tick = async (): Promise<void> => {
		const sent = await attemptAsync(async () => {
			const item = await read();
			// Nothing to tell: no event and no keep-alive. The next interval asks again.
			if (item === undefined) return;
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

	request.raw.on("close", () => {
		closed = true;
		clearTimeout(timer);
	});
	void tick();
}
