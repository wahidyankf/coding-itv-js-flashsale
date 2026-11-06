import { describe, expect, it } from "vitest";
import {
	formatFrame,
	KEEP_ALIVE_FRAME,
	parseFrames,
	readStreamEvent,
} from "./sse.js";

describe("formatFrame and parseFrames", () => {
	it("round-trips a frame", () => {
		const text = formatFrame("sale", { id: "s1" });
		expect(text).toBe('event: sale\ndata: {"id":"s1"}\n\n');
		expect(parseFrames(text)).toEqual({
			frames: [{ event: "sale", data: { id: "s1" } }],
			rest: "",
		});
	});

	it("keeps an incomplete frame for the next chunk", () => {
		const first = parseFrames('event: sale\ndata: {"a"');
		expect(first).toEqual({ frames: [], rest: 'event: sale\ndata: {"a"' });
		expect(parseFrames(`${first.rest}:1}\n\n`).frames).toEqual([
			{ event: "sale", data: { a: 1 } },
		]);
	});

	it("skips a keep-alive comment, a frame without data and a frame that is not JSON", () => {
		const text = `${KEEP_ALIVE_FRAME}event: x\n\ndata: {oops\n\n${formatFrame("a", 1)}`;
		expect(parseFrames(text).frames).toEqual([{ event: "a", data: 1 }]);
	});

	it("names a frame without an event `message`", () => {
		expect(parseFrames("data: 2\n\n").frames).toEqual([
			{ event: "message", data: 2 },
		]);
	});
});

describe("readStreamEvent", () => {
	const sale = {
		id: "s1",
		name: "Drop",
		status: "active",
		startsAt: "2026-01-01T00:00:00.000Z",
		endsAt: "2026-01-01T01:00:00.000Z",
		stock: 3,
		remaining: 2,
	};

	it("reads a sale and a place", () => {
		expect(readStreamEvent({ event: "sale", data: sale })?.event).toBe("sale");
		const place = { userId: "a", state: "admitted" };
		expect(readStreamEvent({ event: "place", data: place })?.event).toBe(
			"place",
		);
	});

	it("refuses data that does not fit, and an event it does not know", () => {
		expect(readStreamEvent({ event: "sale", data: {} })).toBeUndefined();
		expect(readStreamEvent({ event: "place", data: {} })).toBeUndefined();
		expect(readStreamEvent({ event: "other", data: sale })).toBeUndefined();
	});
});
