import type { QueueStore } from "../../../application/ports/queue-store.js";
import type { QueuePlace } from "../../../domain/queue.js";
import { MS_PER_SECOND } from "../../../domain/time.js";
import type { RedisClient } from "./redis-client.js";

const queueKey = (saleId: string) => `sale:${saleId}:queue`;
const admittedKey = (saleId: string) => `sale:${saleId}:admitted`;
const sequenceKey = (saleId: string) => `sale:${saleId}:queue-seq`;
const leaderKey = (saleId: string) => `sale:${saleId}:admit-lead`;

// Result codes: 0 = new place, 1 = already waiting, 2 = admitted, 3 = not in the queue.
// One script means no other command can run between the check and the add, so a user is never both waiting and
// admitted. The arrival number comes from a counter, so users who join in the same millisecond keep their order.
const JOIN = `
local admitted = redis.call('ZSCORE', KEYS[2], ARGV[1])
if admitted and tonumber(admitted) > tonumber(ARGV[2]) then return {2, 0} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank then return {1, rank + 1} end
local arrival = redis.call('INCR', KEYS[3])
redis.call('ZADD', KEYS[1], arrival, ARGV[1])
return {0, redis.call('ZRANK', KEYS[1], ARGV[1]) + 1}
`;

const PLACE = `
local admitted = redis.call('ZSCORE', KEYS[2], ARGV[1])
if admitted and tonumber(admitted) > tonumber(ARGV[2]) then return {2, 0} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank then return {1, rank + 1} end
return {3, 0}
`;

const ADMIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
local users = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
for _, user in ipairs(users) do
  redis.call('ZREM', KEYS[1], user)
  redis.call('ZADD', KEYS[2], ARGV[2], user)
end
return users
`;

// The codes the scripts above answer with, by name, for the two outcomes that carry no place.
const PLACE_CODE = { admitted: 2, absent: 3 } as const;

function toPlace(reply: unknown): QueuePlace {
	const [code, place] = reply as [number, number];
	if (code === PLACE_CODE.admitted) return { state: "admitted" };
	if (code === PLACE_CODE.absent) return { state: "absent" };
	return { state: "waiting", place: place as number };
}

export function createRedisQueueStore(redis: RedisClient): QueueStore {
	return {
		async join(saleId, user, now) {
			const reply = await redis.eval(JOIN, {
				keys: [queueKey(saleId), admittedKey(saleId), sequenceKey(saleId)],
				arguments: [user, String(now.getTime())],
			});
			return { place: toPlace(reply), created: (reply as number[])[0] === 0 };
		},

		async place(saleId, user, now) {
			const reply = await redis.eval(PLACE, {
				keys: [queueKey(saleId), admittedKey(saleId)],
				arguments: [user, String(now.getTime())],
			});
			return toPlace(reply);
		},

		async admit(saleId, count, now, ttlSeconds) {
			const expiresAt = now.getTime() + ttlSeconds * MS_PER_SECOND;
			const users = await redis.eval(ADMIT, {
				keys: [queueKey(saleId), admittedKey(saleId)],
				arguments: [String(count), String(expiresAt), String(now.getTime())],
			});
			return users as string[];
		},

		async tryLead(saleId, ms) {
			const reply = await redis.set(leaderKey(saleId), "1", {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},
	};
}
