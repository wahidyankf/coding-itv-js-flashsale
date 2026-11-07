// The rate limit rules: when a count is over its limit, and how long a refused client is told to wait. These are the
// domain's, so the rate limiter asks them and keeps no rule of its own.
import { describe, expect, it } from "vitest";
import { isOverLimit, retryAfterSecondsOf, verdictOf } from "./rate-limit.js";

describe("the seconds a refused client is told to wait", () => {
	it("rounds the time left up to whole seconds", () => {
		expect(retryAfterSecondsOf(1000)).toBe(1);
		expect(retryAfterSecondsOf(1001)).toBe(2);
		expect(retryAfterSecondsOf(2500)).toBe(3);
	});

	it("never says a client to retry at once: the wait is at least one second", () => {
		expect(retryAfterSecondsOf(0)).toBe(1);
		expect(retryAfterSecondsOf(200)).toBe(1);
	});
});

describe("whether a count is over its limit", () => {
	it("is over only when the hits are more than the limit allows", () => {
		expect(isOverLimit({ count: 5, limit: 5 })).toBe(false);
		expect(isOverLimit({ count: 6, limit: 5 })).toBe(true);
	});
});

describe("the verdict of the windows of one check", () => {
	it("lets the request on when no window is over its limit", () => {
		expect(verdictOf([])).toEqual({ limited: false });
		expect(verdictOf([{ count: 1, limit: 5, resetInMs: 9000 }])).toEqual({
			limited: false,
		});
	});

	it("refuses with the wait of the one window that is over", () => {
		expect(
			verdictOf([
				{ count: 6, limit: 5, resetInMs: 4000 },
				{ count: 1, limit: 5, resetInMs: 9000 },
			]),
		).toEqual({ limited: true, retryAfterSeconds: 4 });
	});

	it("refuses with the longest wait when more than one window is over", () => {
		expect(
			verdictOf([
				{ count: 6, limit: 5, resetInMs: 4000 },
				{ count: 7, limit: 5, resetInMs: 8000 },
			]),
		).toEqual({ limited: true, retryAfterSeconds: 8 });
	});
});
