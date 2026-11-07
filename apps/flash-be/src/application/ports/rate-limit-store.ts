// The counter behind the rate limit. Redis counts for every instance; a memory copy counts when Redis is down, so an
// outage never switches the limit off. Application layer, port.
import type { Result } from "@flash/typekit";
import type { UnreadableReply } from "./reply.js";

// The count so far in one window, and the time left in it.
export type RateLimitCount = { count: number; resetInMs: number };

// The shared counter. It is Redis, so a reply it cannot be read is a failure value.
export type RateLimitStore = {
	// Adds one hit to `key` for the window that holds `now`.
	hit(
		key: string,
		windowMs: number,
		now: Date,
	): Promise<Result<RateLimitCount, UnreadableReply>>;
};

// The counter of this process, used when the shared one is down. It cannot fail, so it answers without a Result.
export type LocalRateLimitStore = {
	hit(key: string, windowMs: number, now: Date): Promise<RateLimitCount>;
};
