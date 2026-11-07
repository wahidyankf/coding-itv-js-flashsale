// The rate-limit counter in Redis, shared by every instance. Outbound Redis adapter for the RateLimitStore port. When Redis
// is down, the application counts in a memory copy instead (see memory-rate-limit-store).
import { Err, Ok, type Result } from "@flash/typekit";
import type {
	RateLimitCount,
	RateLimitStore,
} from "../../../application/ports/rate-limit-store.js";
import type { UnreadableReply } from "../../../application/ports/reply.js";
import type { RedisClient } from "./redis-client.js";
import { arrayReply, UNREADABLE } from "./reply.js";

// The first hit creates the key and sets its expiry, so the window starts at that hit and the key disappears with it.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

// Reads the reply of HIT: the hits so far, and the time left in the window. Redis answers a negative time for a key with
// no expiry left, which counts as no time left.
export function hitReplyOf(
	reply: unknown,
): Result<RateLimitCount, UnreadableReply> {
	const read = arrayReply(reply);
	if (read.isErr()) return new Err(read.error);
	const [count, ttl] = read.value;
	if (typeof count !== "number" || typeof ttl !== "number") {
		return new Err(UNREADABLE);
	}
	return new Ok({ count, resetInMs: Math.max(ttl, 0) });
}

// Counts hits of a key in a fixed window, in Redis.
export function createRedisRateLimitStore(redis: RedisClient): RateLimitStore {
	return {
		async hit(key, windowMs) {
			const reply = await redis.eval(HIT, {
				keys: [`ratelimit:${key}`],
				arguments: [String(windowMs)],
			});
			return hitReplyOf(reply);
		},
	};
}
