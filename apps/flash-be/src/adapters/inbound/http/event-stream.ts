// Server-Sent Events for the HTTP adapter: a loop that reads the state every interval and writes an event to the client
// only when the state changed. It belongs to the inbound layer, so it knows about the HTTP reply and nothing of the rules.
import { attemptAsync } from "@flash/typekit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HTTP_STATUS } from "./errors.js";

// A comment line, which a client skips.
const KEEP_ALIVE_FRAME = ": keep-alive\n\n";

// How the stream is paced. The server sets the interval from the configuration; the heartbeat keeps its default. Tests set
// both.
export type StreamOptions = {
	// How often the source is read.
	intervalMs: number;
	// A comment line is sent when nothing else was, so proxies do not close an idle connection.
	heartbeatMs: number;
};

// One thing to tell the client. `data` is sent as JSON and compared with the last one, so an unchanged state is
// not repeated.
export type StreamItem = { event: string; data: unknown };

// The pacing a server uses when the configuration does not set it: one read a second, and a keep-alive every 15 seconds.
export const DEFAULT_STREAM_OPTIONS: StreamOptions = {
	intervalMs: 1000,
	heartbeatMs: 15_000,
};

// The text of one event as it goes on the wire: its name on one line and its JSON data on the next, then a blank line.
export function formatEvent(item: StreamItem): string {
	return `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`;
}

// Turns the request into a Server-Sent Events stream. `read` is called every interval. It returns what to tell the client,
// or nothing when there is nothing to tell this time (a sale that is gone). The client hears about it only when the
// result changed. The loop stops when the client goes away. Callers check the request before this, so errors can still
// be sent as normal JSON replies.
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
