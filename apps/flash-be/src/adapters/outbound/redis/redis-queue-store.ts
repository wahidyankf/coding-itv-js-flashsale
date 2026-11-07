// The line of shoppers for a sale in Redis, and who the queue has admitted. Every instance sees one line, and a lost line
// lets shoppers through (see queue-service). Outbound Redis adapter for the QueueStore port.

import { MS_PER_SECOND } from "@flash/flash-commons";
import type { QueueStore } from "../../../application/ports/queue-store.js";
import type { QueuePlace } from "../../../domain/queue.js";
import type { RedisClient } from "./redis-client.js";
import { saleKey } from "./redis-keys.js";

// KEYS: queue (waiting shoppers, scored by arrival), admitted (scored by when the admission ends), queue-seq (the arrival
// counter). ARGV: user, now. Replies {code, place}: 0 a new place, 1 already waiting, 2 admitted, see the codes below.
// One script means no other command runs between the check and the add, so a shopper is never both waiting and admitted.
// The arrival number comes from a counter, so shoppers who join in the same millisecond keep their order. An admission
// counts while its end is after now, so a lapsed one no longer keeps the shopper out of the line.
const JOIN = `
local admitted = redis.call('ZSCORE', KEYS[2], ARGV[1])
if admitted and tonumber(admitted) > tonumber(ARGV[2]) then return {2, 0} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank then return {1, rank + 1} end
local arrival = redis.call('INCR', KEYS[3])
redis.call('ZADD', KEYS[1], arrival, ARGV[1])
return {0, redis.call('ZRANK', KEYS[1], ARGV[1]) + 1}
`;

// KEYS: queue, admitted. ARGV: user, now. The same answers as JOIN, read only: it never adds a shopper to the line.
const PLACE = `
local admitted = redis.call('ZSCORE', KEYS[2], ARGV[1])
if admitted and tonumber(admitted) > tonumber(ARGV[2]) then return {2, 0} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank then return {1, rank + 1} end
return {3, 0}
`;

// KEYS: queue, admitted. ARGV: count, admission end, now. Moves the first `count` waiting shoppers to admitted.
// It first drops the admissions that have ended (their score is at or before now). Those no longer count, so the set holds
// only live admissions and does not grow without bound. This runs with each admission tick, so no sweep job is needed.
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
// The code JOIN answers with when the shopper takes a new place in the line (the first reply value, 0).
const JOIN_CODE = { newPlace: 0 } as const;

// Reads the reply of a script: its code, and the place that goes with the code.
function toPlace(reply: unknown): QueuePlace {
	const [code, place] = reply as [number, number];
	if (code === PLACE_CODE.admitted) return { state: "admitted" };
	if (code === PLACE_CODE.absent) return { state: "absent" };
	return { state: "waiting", place };
}

// The queue over Redis. Each method is one script or one plain command, and each returns what the domain needs.
export function createRedisQueueStore(redis: RedisClient): QueueStore {
	return {
		async join(saleId, user, now) {
			const reply = await redis.eval(JOIN, {
				keys: [
					saleKey(saleId, "queue"),
					saleKey(saleId, "admitted"),
					saleKey(saleId, "queue-seq"),
				],
				arguments: [user, String(now.getTime())],
			});
			return {
				place: toPlace(reply),
				created: (reply as number[])[0] === JOIN_CODE.newPlace,
			};
		},

		async place(saleId, user, now) {
			const reply = await redis.eval(PLACE, {
				keys: [saleKey(saleId, "queue"), saleKey(saleId, "admitted")],
				arguments: [user, String(now.getTime())],
			});
			return toPlace(reply);
		},

		async admit(saleId, count, now, ttlSeconds) {
			const expiresAt = now.getTime() + ttlSeconds * MS_PER_SECOND;
			const users = await redis.eval(ADMIT, {
				keys: [saleKey(saleId, "queue"), saleKey(saleId, "admitted")],
				arguments: [String(count), String(expiresAt), String(now.getTime())],
			});
			return users as string[];
		},

		// Only one instance admits in a tick, so the line moves at the sale's rate. The lead lasts one millisecond less than a
		// tick, so it is free again by the next tick.
		async tryLead(saleId, ms) {
			const reply = await redis.set(saleKey(saleId, "admit-lead"), "1", {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},
	};
}
