// A Server-Sent Events stream as the steps read it: the events one by one, each read with a time limit, and a way to close the
// stream. The steps that watch a sale or a place open one and close it in cleanup.

import { sleep } from "@flash/flash-commons/timers";
import type { StreamEvent } from "./views.js";

// An open stream: `next` reads the following event, and `close` ends the connection.
export type Stream = {
	next: () => Promise<StreamEvent>;
	close: () => void;
};

const NEXT_EVENT_TIMEOUT_MS = 8000;
const POLL_MS = 200;

// Splits the text that arrived so far into events, and returns them with the unfinished rest. Keep-alive comments and
// events other than sale and place are skipped.
function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
	const events: StreamEvent[] = [];
	const frames = buffer.split("\n\n");
	const rest = frames.pop() ?? "";
	for (const frame of frames) {
		const event = /^event: (.*)$/m.exec(frame)?.[1];
		const data = /^data: (.*)$/m.exec(frame)?.[1];
		if ((event === "sale" || event === "place") && data !== undefined) {
			events.push({ event, data: JSON.parse(data) } as StreamEvent);
		}
	}
	return { events, rest };
}

// Opens the stream at `url` with these headers. Throws when the server does not open it. Read the events with `next`.
export async function openStream(
	url: string,
	headers: Record<string, string> = {},
): Promise<Stream> {
	const controller = new AbortController();
	const reply = await fetch(url, { headers, signal: controller.signal });
	if (!reply.ok || !reply.body) {
		throw new Error(`the stream did not open: ${reply.status}`);
	}
	const reader = reply.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const events: StreamEvent[] = [];

	const fill = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) throw new Error("the stream ended");
		buffer += decoder.decode(chunk.value, { stream: true });
		const parsed = parseEvents(buffer);
		buffer = parsed.rest;
		events.push(...parsed.events);
	};

	return {
		async next() {
			const deadline = Date.now() + NEXT_EVENT_TIMEOUT_MS;
			while (events.length === 0) {
				if (Date.now() > deadline) throw new Error("no event in time");
				await Promise.race([fill(), sleep(POLL_MS)]);
			}
			const event = events.shift();
			if (!event) throw new Error("no event");
			return event;
		},
		close: () => controller.abort(),
	};
}
