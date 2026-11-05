// Counts hits per key in a fixed window. Redis counts for all instances; a memory copy covers an outage.
export type RateLimitStore = {
	// Adds one hit to `key` for the window that holds `now`, and returns the count and the time left in the window.
	hit(
		key: string,
		windowMs: number,
		now: Date,
	): Promise<{ count: number; resetInMs: number }>;
};
