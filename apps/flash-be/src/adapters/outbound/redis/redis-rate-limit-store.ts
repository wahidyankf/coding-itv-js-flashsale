// The rate-limit counter in Redis, shared by every instance. Outbound Redis adapter for the RateLimitStore port. When Redis
// is down, the application counts in a memory copy instead (see memory-rate-limit-store).
import type { RateLimitStore } from "../../../application/ports/rate-limit-store.js";
import type { RedisClient } from "./redis-client.js";

// The first hit creates the key and sets its expiry, so the window starts at that hit and the key disappears with it.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

// Counts hits of a key in a fixed window, in Redis.
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
