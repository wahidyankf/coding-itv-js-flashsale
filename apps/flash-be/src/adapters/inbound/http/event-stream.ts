import { formatFrame, HTTP_STATUS, KEEP_ALIVE_FRAME } from "@flash/contract";
import { attemptAsync } from "@flash/typekit";
import type { FastifyReply, FastifyRequest } from "fastify";

export type StreamOptions = {
	// How often the source is read.
	intervalMs: number;
	// A comment line is sent when nothing else was, so proxies do not close an idle connection.
	heartbeatMs: number;
};

// One thing to tell the client. `data` is sent as JSON and compared with the last one, so an unchanged state is
// not repeated.
export type StreamItem = { event: string; data: unknown };

export const DEFAULT_STREAM_OPTIONS: StreamOptions = {
	intervalMs: 1000,
	heartbeatMs: 15_000,
};

export function formatEvent(item: StreamItem): string {
	return formatFrame(item.event, item.data);
}

// Turns the request into a Server-Sent Events stream. `read` is called every interval; the client hears about it
// only when the result changed. The loop stops when the client goes away. Callers check the request before this,
// so errors can still be sent as normal JSON replies.
export function serveEvents(
	request: FastifyRequest,
	reply: FastifyReply,
	read: () => Promise<StreamItem>,
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
