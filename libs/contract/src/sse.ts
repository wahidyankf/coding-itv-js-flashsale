// Server-Sent Events: how a frame is written and how the text that arrived so far is split back into frames.
// One codec serves the server, the browser and the tests.

import { attempt, type Option, Some } from "@flash/typekit";
import { PlaceView, SaleView } from "./schemas.js";

export const KEEP_ALIVE_FRAME = ": keep-alive\n\n";

export type Frame = { event: string; data: unknown };

export function formatFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

// The two events the API sends.
export type StreamEvent =
	| { event: "sale"; data: SaleView }
	| { event: "place"; data: PlaceView };

export function readStreamEvent(frame: Frame): Option<StreamEvent> {
	if (frame.event === "sale") {
		const sale = SaleView.safeParse(frame.data);
		return sale.success
			? new Some({ event: "sale", data: sale.data })
			: undefined;
	}
	if (frame.event === "place") {
		const place = PlaceView.safeParse(frame.data);
		return place.success
			? new Some({ event: "place", data: place.data })
			: undefined;
	}
	return undefined;
}
