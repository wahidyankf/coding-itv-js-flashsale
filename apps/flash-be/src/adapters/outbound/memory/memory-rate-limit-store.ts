// The rate-limit counter kept in this process. Outbound adapter for the LocalRateLimitStore port. It is the fallback when
// Redis is down: the application counts here instead (see decision 003), so the limit never switches off.
import type { LocalRateLimitStore } from "../../../application/ports/rate-limit-store.js";

// Hits counted inside this process. Each instance counts alone while Redis is down, so the limit is looser across
// instances, but it still protects every instance.
export function createMemoryRateLimitStore(): LocalRateLimitStore {
	const windows = new Map<string, { count: number; endsAt: number }>();
	// The next time the map is swept. A sweep walks every key, so it runs at most once per window, not on each hit: a flood
	// of distinct keys then costs one pass per window, not one pass per hit.
	let nextSweepAt = Number.NEGATIVE_INFINITY;

	return {
		async hit(key, windowMs, now) {
			const at = now.getTime();
			if (at >= nextSweepAt) {
				for (const [name, window] of windows) {
					if (window.endsAt <= at) windows.delete(name);
				}
				nextSweepAt = at + windowMs;
			}
			// A window that has ended is never reused, even when the sweep has not dropped it yet.
			const known = windows.get(key);
			const window =
				known !== undefined && known.endsAt > at
					? known
					: { count: 0, endsAt: at + windowMs };
			// The window starts at the first hit, so a burst is never split by a clock boundary.
			window.count += 1;
			windows.set(key, window);
			return { count: window.count, resetInMs: window.endsAt - at };
		},
	};
}
