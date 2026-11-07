// The hold gate in Redis: the fast answer to "who holds or bought an item of this sale". Redis decides first, and Postgres
// has the last word (decision 002). Outbound Redis adapter for the HoldGate port.
import { Err, Ok, type Result } from "@flash/typekit";
import type { HoldGate } from "../../../application/ports/hold-gate.js";
import type { UnreadableReply } from "../../../application/ports/reply.js";
import type { GateAnswer, HoldSnapshot } from "../../../domain/reservation.js";
import type { RedisClient } from "./redis-client.js";
import { saleKey } from "./redis-keys.js";
import { arrayReply, UNREADABLE } from "./reply.js";

// The first number that each reply of the scripts below carries, by name.
const GATE_CODE = {
	soldOut: 0,
	reserved: 1,
	purchased: 2,
	held: 3,
	notReady: 4,
} as const;

// Every script below runs as one Redis call, so no other command can run between its read and its write. Do not use
// MULTI for them: while Redis is down, node-redis holds a MULTI until its own timeout, which slowed every payment during
// an outage (decision 003). A script fails at once instead. The rebuild's restore is a script too, so it never waits
// for the connection either.

// KEYS: ready, buyers, holds, ids. ARGV: user, now, expiresAt, stock, reservationId.
// Replies: {0} sold out, {1, id, expiresAt} reserved, {2} bought, {3, id, expiresAt} already holding, {4} not ready.
// The invariant: the stock is never exceeded, and one shopper gets at most one item. The SISMEMBER on buyers stops a shopper
// who already bought (code 2) before any stock is counted, so a second item cannot be held. ZSCORE gives back the shopper's
// own live hold (code 3), so a retry gets the same hold. Code 4 means Redis has no state for this sale. The service then
// rebuilds it from Postgres and asks again, so Redis never decides for a sale it does not know.
// The count below takes a hold that expires exactly now as live (`>=`). Postgres and the domain's isLive do not (`>`).
// The one millisecond difference errs on the safe side: Redis may refuse, but it never oversells.
// An expired hold has a score in the past, so it stops counting by itself: no sweep job and no counter to drift.
// The same decision is in `decideReservation` (domain/reservation.ts), which the Postgres fallback and the memory
// reservation repository use. Keep the two in step: the order of the checks is the rule.
const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {4} end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return {2} end
local now = tonumber(ARGV[2])
local score = redis.call('ZSCORE', KEYS[3], ARGV[1])
if score and tonumber(score) > now then
  return {3, redis.call('HGET', KEYS[4], ARGV[1]), tostring(score)}
end
local used = redis.call('SCARD', KEYS[2]) + redis.call('ZCOUNT', KEYS[3], now, '+inf')
if used >= tonumber(ARGV[4]) then return {0} end
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[4], ARGV[1], ARGV[5])
return {1, ARGV[5], ARGV[3]}
`;

// KEYS: holds, ids. ARGV: user. Frees the hold of a user.
const RELEASE = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return 1
`;

// KEYS: buyers, holds, ids. ARGV: user. Records the purchase and frees the hold, so the shopper cannot hold again.
const CONFIRM = `
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
`;

// KEYS: buyers, holds, ids, ready. ARGV: the buyer count, the buyers, the hold count, then for each hold its user, its
// reservation id and its expiry score (see restoreArguments). Replaces the state of a sale with a snapshot and marks it
// ready, in one call, so no reservation sees a half-restored sale.
const RESTORE = `
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
local at = 1
local buyers = tonumber(ARGV[at])
at = at + 1
for _ = 1, buyers do
  redis.call('SADD', KEYS[1], ARGV[at])
  at = at + 1
end
local holds = tonumber(ARGV[at])
at = at + 1
for _ = 1, holds do
  redis.call('ZADD', KEYS[2], ARGV[at + 2], ARGV[at])
  redis.call('HSET', KEYS[3], ARGV[at], ARGV[at + 1])
  at = at + 3
end
redis.call('SET', KEYS[4], '1')
return 1
`;

// KEYS: rebuild-lock. ARGV: owner. Deletes the lock only while this owner still holds it, so a rebuild that ran past its
// lock time cannot free the lock of the instance that took over.
const UNLOCK_REBUILD = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

// The ARGV of RESTORE: the buyer count and the buyers, then the hold count and each hold as user, reservation id and
// expiry. A count tells the script how many values follow, so no separator can clash with a name.
export function restoreArguments(snapshot: HoldSnapshot): string[] {
	const holds = snapshot.holds.flatMap((hold) => [
		hold.user,
		hold.reservationId,
		String(hold.expiresAt.getTime()),
	]);
	return [
		String(snapshot.buyers.length),
		...snapshot.buyers,
		String(snapshot.holds.length),
		...holds,
	];
}

// Reads the reply of RESERVE as the domain's answer. A reply the script does not write is a failure value, never a
// guess, so the caller can treat the gate as down.
export function gateAnswerOf(
	reply: unknown,
): Result<GateAnswer, UnreadableReply> {
	const read = arrayReply(reply);
	if (read.isErr()) return new Err(read.error);
	const [code, id, until] = read.value;
	if (typeof code !== "number") return new Err(UNREADABLE);
	if (code === GATE_CODE.soldOut) return new Ok({ kind: "sold_out" });
	if (code === GATE_CODE.purchased) return new Ok({ kind: "purchased" });
	if (code === GATE_CODE.notReady) return new Ok({ kind: "not_ready" });
	if (code !== GATE_CODE.reserved && code !== GATE_CODE.held) {
		return new Err(UNREADABLE);
	}
	// A hold answer names its reservation id and its expiry. The expiry is the score the script wrote, as text.
	if (typeof id !== "string" || typeof until !== "string") {
		return new Err(UNREADABLE);
	}
	const expiresAt = new Date(Number(until));
	if (Number.isNaN(expiresAt.getTime())) return new Err(UNREADABLE);
	return new Ok(
		code === GATE_CODE.reserved
			? { kind: "reserved", reservationId: id, expiresAt }
			: { kind: "held", reservationId: id, expiresAt },
	);
}

// The gate over Redis. Each method is one script or one plain command, and the answers are the domain's GateAnswer.
export function createRedisHoldGate(redis: RedisClient): HoldGate {
	return {
		async reserve(request) {
			const reply = await redis.eval(RESERVE, {
				keys: [
					saleKey(request.saleId, "ready"),
					saleKey(request.saleId, "buyers"),
					saleKey(request.saleId, "holds"),
					saleKey(request.saleId, "ids"),
				],
				arguments: [
					request.user,
					String(request.now.getTime()),
					String(request.expiresAt.getTime()),
					String(request.stock),
					request.reservationId,
				],
			});
			return gateAnswerOf(reply);
		},

		async release(saleId, user) {
			await redis.eval(RELEASE, {
				keys: [saleKey(saleId, "holds"), saleKey(saleId, "ids")],
				arguments: [user],
			});
		},

		async confirm(saleId, user) {
			await redis.eval(CONFIRM, {
				keys: [
					saleKey(saleId, "buyers"),
					saleKey(saleId, "holds"),
					saleKey(saleId, "ids"),
				],
				arguments: [user],
			});
		},

		async isReady(saleId) {
			return (await redis.exists(saleKey(saleId, "ready"))) === 1;
		},

		async invalidate(saleId) {
			await redis.del(saleKey(saleId, "ready"));
		},

		// The rebuild runs after its rebuild lock is taken, and it is one script, so it waits for the connection no more
		// than a reservation does.
		async restore(saleId, snapshot) {
			await redis.eval(RESTORE, {
				keys: [
					saleKey(saleId, "buyers"),
					saleKey(saleId, "holds"),
					saleKey(saleId, "ids"),
					saleKey(saleId, "ready"),
				],
				arguments: restoreArguments(snapshot),
			});
		},

		// One instance rebuilds a sale at a time. The lock expires by itself, so a dead instance does not hold it, and it
		// carries the owner's token so that only the owner can release it.
		async lockRebuild(saleId, ms, owner) {
			const reply = await redis.set(saleKey(saleId, "rebuild-lock"), owner, {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},

		async unlockRebuild(saleId, owner) {
			await redis.eval(UNLOCK_REBUILD, {
				keys: [saleKey(saleId, "rebuild-lock")],
				arguments: [owner],
			});
		},
	};
}
