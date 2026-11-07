// Unit tests for how the Redis rate-limit store reads the reply of its hit script. A reply it does not write is a failure
// value, so the limiter counts locally instead. The script itself runs in Redis (integration tests).
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { hitReplyOf } from "./redis-rate-limit-store.js";

describe("the reply of the hit script", () => {
	it("reads the count and the time left in the window", () => {
		expect(hitReplyOf([3, 500])).toEqual(new Ok({ count: 3, resetInMs: 500 }));
	});

	// Redis answers -2 for a key that has no expiry left, and the time left is never negative.
	it("reads a key with no time left as no time left", () => {
		expect(hitReplyOf([1, -2])).toEqual(new Ok({ count: 1, resetInMs: 0 }));
	});

	it.each([
		["a missing count", []],
		["a count that is not a number", ["3", 500]],
		["a reply that is not a list", 3],
	])("refuses %s as unreadable", (_name, reply) => {
		expect(hitReplyOf(reply)).toEqual(new Err("unreadable_reply"));
	});
});
