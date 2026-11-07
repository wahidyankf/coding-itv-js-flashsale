// The Redis client's reconnect policy, as pure functions: the wait before each try, and no point at which it gives up.
import { SocketTimeoutError } from "@redis/client";
import { describe, expect, it } from "vitest";
import { reconnectDelayMs, reconnectStrategy } from "./redis-client.js";

// A draw of one half takes half of each bound, so each wait below is easy to read.
const HALF = () => 0.5;

describe("reconnectDelayMs", () => {
	it("starts at a 50 ms bound and doubles it, with full jitter", () => {
		expect(reconnectDelayMs(0, HALF)).toBe(25);
		expect(reconnectDelayMs(1, HALF)).toBe(50);
		expect(reconnectDelayMs(2, HALF)).toBe(100);
	});

	it("stops growing at a 2 s bound", () => {
		expect(reconnectDelayMs(20, HALF)).toBe(1000);
	});
});

describe("reconnectStrategy", () => {
	// The API must catch up when Redis returns, so the client keeps trying: there is no give-up answer.
	it("answers with a wait after any number of failed tries", () => {
		const strategy = reconnectStrategy(HALF);
		expect(strategy(0, new Error("refused"))).toBe(25);
		expect(strategy(1_000_000, new Error("refused"))).toBe(1000);
	});

	// node-redis's default answers `false` after a socket timeout and never reconnects. This policy waits instead.
	it("answers with a wait after a socket timeout", () => {
		const strategy = reconnectStrategy(HALF);
		expect(strategy(3, new SocketTimeoutError(1000))).toBe(
			reconnectDelayMs(3, HALF),
		);
	});
});
