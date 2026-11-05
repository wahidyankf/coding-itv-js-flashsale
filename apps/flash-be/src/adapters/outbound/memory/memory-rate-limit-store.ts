import type { RateLimitStore } from "../../../application/ports/rate-limit-store.js";

// Hits counted inside this process. It is the fallback when Redis is down: each instance then counts alone, so the
// limit is looser across instances, but it still protects every instance.
export function createMemoryRateLimitStore(): RateLimitStore {
	const windows = new Map<string, { count: number; endsAt: number }>();

	return {
		async hit(key, windowMs, now) {
			const at = now.getTime();
			// Old windows are dropped as we go, so the map cannot grow without bound.
			for (const [name, window] of windows) {
				if (window.endsAt <= at) windows.delete(name);
			}
			// The window starts at the first hit, so a burst is never split by a clock boundary.
			const window = windows.get(key) ?? { count: 0, endsAt: at + windowMs };
			window.count += 1;
			windows.set(key, window);
			return { count: window.count, resetInMs: window.endsAt - at };
		},
	};
}
