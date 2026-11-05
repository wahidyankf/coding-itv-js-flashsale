import type { RedisClient } from "../redis.js";
import type { RateLimitStore } from "./rate-limit-store.js";

// The first hit creates the key and sets its expiry, so the window starts at that hit and the key disappears with it.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

export function createRedisRateLimitStore(redis: RedisClient): RateLimitStore {
	return {
		async hit(key, windowMs) {
			const [count, ttl] = (await redis.eval(HIT, {
				keys: [`ratelimit:${key}`],
				arguments: [String(windowMs)],
			})) as [number, number];
			return { count, resetInMs: Math.max(ttl, 0) };
		},
	};
}
