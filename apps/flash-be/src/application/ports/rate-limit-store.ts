// Kind: store (keyed counters in Redis; LocalRateLimitStore is the memory copy of the same rule). Application layer,
// port. Redis counts for every instance. A memory copy counts when Redis is down, so an outage never switches the limit off.
import type { Result } from "@flash/typekit";
import type { UnreadableReply } from "./reply.js";

// The count so far in one window, and the time left in it.
export type RateLimitCount = { count: number; resetInMs: number };

// The shared counter in Redis. A reply that cannot be read comes back as a failure value.
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
