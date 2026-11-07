// The rate limit as the rules see it (domain layer): whether a count is over its limit, and how long a refused client is
// told to wait. The counts come from the store and the limits from the configuration; the rate limiter asks these
// functions what the counts mean. No I/O.
import { MS_PER_SECOND } from "@flash/flash-commons";

// The answer to one limit check: allowed, or refused with the seconds to wait.
export type RateLimitVerdict =
	| { limited: false }
	| { limited: true; retryAfterSeconds: number };

// One counted window: the hits so far, the time left in the window, and the limit those hits are held to.
export type CountedWindow = { count: number; resetInMs: number; limit: number };

// A client told to retry is never told to retry at once: the wait is at least one second.
const MIN_RETRY_AFTER_SECONDS = 1;

// The seconds a refused client is told to wait: the time left in the window, rounded up, and never under the minimum.
export function retryAfterSecondsOf(resetInMs: number): number {
	return Math.max(
		Math.ceil(resetInMs / MS_PER_SECOND),
		MIN_RETRY_AFTER_SECONDS,
	);
}

// Whether a window is over its limit: its hits are more than the limit allows.
export function isOverLimit(window: { count: number; limit: number }): boolean {
	return window.count > window.limit;
}

// The verdict of one check over its windows. The check is refused when any window is over its limit, and the client
// waits for the longest of the windows that are over. Otherwise the request goes on.
export function verdictOf(windows: readonly CountedWindow[]): RateLimitVerdict {
	const over = windows.filter(isOverLimit);
	if (over.length === 0) return { limited: false };
	const longest = Math.max(...over.map((window) => window.resetInMs));
	return { limited: true, retryAfterSeconds: retryAfterSecondsOf(longest) };
}
