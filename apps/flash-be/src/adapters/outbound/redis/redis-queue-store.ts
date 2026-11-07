// The line of shoppers for a sale in Redis, and who the queue has admitted. Every instance sees one line, and a lost line
// lets shoppers through (see queue-service). Outbound Redis adapter for the QueueStore port.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { Err, Ok, type Result } from "@flash/typekit";
import type { QueueStore } from "../../../application/ports/queue-store.js";
import type { UnreadableReply } from "../../../application/ports/reply.js";
import type { QueuePlace } from "../../../domain/queue.js";
import { storedUsername, type Username } from "../../../domain/user.js";
import type { RedisClient } from "./redis-client.js";
import { saleKey } from "./redis-keys.js";

// KEYS: queue (waiting shoppers, scored by arrival), admitted (scored by when the admission ends), queue-seq (the arrival
// counter). ARGV: user, now. Replies {code, value}: 0 a new place, 1 already waiting, 2 admitted, see the codes below.
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

// The codes the scripts answer with, by name. A place is the number that goes with a waiting code.
const CODE = { newPlace: 0, waiting: 1, admitted: 2, absent: 3 } as const;

// The failure of a reply that the scripts below do not write.
const UNREADABLE: UnreadableReply = "unreadable_reply";

// A `[code, value]` reply, read as numbers. Anything else is not a reply the scripts write.
function codeAndValue(
	reply: unknown,
): Result<[number, number], UnreadableReply> {
	if (!Array.isArray(reply)) return new Err(UNREADABLE);
	const parts: unknown[] = reply;
	const [code, value] = parts;
	return typeof code === "number" && typeof value === "number"
		? new Ok([code, value])
		: new Err(UNREADABLE);
}

// The place a PLACE reply names. The place script never adds a shopper, so the code of a new place is not one it writes.
export function placeReplyOf(
	reply: unknown,
): Result<QueuePlace, UnreadableReply> {
	const read = codeAndValue(reply);
	if (read.isErr()) return new Err(read.error);
	const [code, value] = read.value;
	if (code === CODE.waiting) return new Ok({ state: "waiting", place: value });
	if (code === CODE.admitted) return new Ok({ state: "admitted" });
	if (code === CODE.absent) return new Ok({ state: "absent" });
	return new Err(UNREADABLE);
}

// The place and whether it is new, from a JOIN reply: a new place or a place already waiting, or an admitted shopper.
export function joinReplyOf(
	reply: unknown,
): Result<{ place: QueuePlace; created: boolean }, UnreadableReply> {
	const read = codeAndValue(reply);
	if (read.isErr()) return new Err(read.error);
	const [code, value] = read.value;
	if (code === CODE.newPlace || code === CODE.waiting) {
		return new Ok({
			place: { state: "waiting", place: value },
			created: code === CODE.newPlace,
		});
	}
	if (code === CODE.admitted) {
		return new Ok({ place: { state: "admitted" }, created: false });
	}
	return new Err(UNREADABLE);
}

const isName = (value: unknown): value is string => typeof value === "string";

// The names the admit script returns: a list of text, one name per admitted shopper.
export function usersOf(reply: unknown): Result<Username[], UnreadableReply> {
	if (!Array.isArray(reply)) return new Err(UNREADABLE);
	const names: unknown[] = reply;
	return names.every(isName)
		? new Ok(names.map(storedUsername))
		: new Err(UNREADABLE);
}

// The queue over Redis. Each method is one script or one plain command, and each returns what the domain needs, or a
// failure value when the reply cannot be read.
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
			return joinReplyOf(reply);
		},

		async place(saleId, user, now) {
			const reply = await redis.eval(PLACE, {
				keys: [saleKey(saleId, "queue"), saleKey(saleId, "admitted")],
				arguments: [user, String(now.getTime())],
			});
			return placeReplyOf(reply);
		},

		async admit(saleId, count, now, ttlSeconds) {
			const expiresAt = now.getTime() + ttlSeconds * MS_PER_SECOND;
			const users = await redis.eval(ADMIT, {
				keys: [saleKey(saleId, "queue"), saleKey(saleId, "admitted")],
				arguments: [String(count), String(expiresAt), String(now.getTime())],
			});
			return usersOf(users);
		},

		// Only one instance admits in a tick, so the line moves at the sale's rate. The caller sets how long the lead lasts
		// (see queue-service); the key expires by itself, so a crashed leader does not hold the line.
		async tryLead(saleId, ms) {
			const reply = await redis.set(saleKey(saleId, "admit-lead"), "1", {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},
	};
}
