// The counter behind the rate limit. Redis counts for every instance; a memory copy counts when Redis is down, so an
// outage never switches the limit off.

// Counts the hits of one key in a fixed window.
export type RateLimitStore = {
	// Adds one hit to `key` for the window that holds `now`. Returns the count so far and the time left in the window.
	hit(
		key: string,
		windowMs: number,
		now: Date,
	): Promise<{ count: number; resetInMs: number }>;
};
