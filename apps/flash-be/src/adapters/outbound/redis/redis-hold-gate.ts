// The hold gate in Redis: the fast answer to "who holds or bought an item of this sale". Redis decides first, and Postgres
// has the last word (decision 002). Outbound Redis adapter for the HoldGate port.
import type { HoldGate } from "../../../application/ports/hold-gate.js";
import type { GateAnswer } from "../../../domain/reservation.js";
import type { RedisClient } from "./redis-client.js";
import { saleKey } from "./redis-keys.js";

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
// an outage (decision 003). A script fails at once instead.

// KEYS: ready, buyers, holds, ids. ARGV: user, now, expiresAt, stock, reservationId.
// Replies: {0} sold out, {1, id, expiresAt} reserved, {2} bought, {3, id, expiresAt} already holding, {4} not ready.
// The invariant: the stock is never exceeded, and one shopper gets at most one item. The SISMEMBER on buyers stops a shopper
// who already bought (code 2) before any stock is counted, so a second item cannot be held. ZSCORE gives back the shopper's
// own live hold (code 3), so a retry gets the same hold. Code 4 means Redis has no state for this sale. The service then
// rebuilds it from Postgres and asks again, so Redis never decides for a sale it does not know.
// The count below takes a hold that expires exactly now as live (`>=`). Postgres and the domain's isLive do not (`>`).
// The one millisecond difference errs on the safe side: Redis may refuse, but it never oversells.
// An expired hold has a score in the past, so it stops counting by itself: no sweep job and no counter to drift.
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

// The gate over Redis. Each method is one script or one plain command, and the answers are the domain's GateAnswer.
export function createRedisHoldGate(redis: RedisClient): HoldGate {
	return {
		async reserve(request) {
			const reply = (await redis.eval(RESERVE, {
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
			})) as Array<number | string>;
			const [code, id, until] = reply;
			const answer = {
				reservationId: String(id),
				expiresAt: new Date(Number(until)),
			};
			const answers: Record<number, GateAnswer> = {
				[GATE_CODE.soldOut]: { kind: "sold_out" },
				[GATE_CODE.reserved]: { kind: "reserved", ...answer },
				[GATE_CODE.purchased]: { kind: "purchased" },
				[GATE_CODE.held]: { kind: "held", ...answer },
				[GATE_CODE.notReady]: { kind: "not_ready" },
			};
			return answers[Number(code)] as GateAnswer;
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

		// MULTI is allowed here, and only here. A rebuild runs after its rebuild lock is taken, off the sale path, so a
		// pipeline that waits for the connection cannot hold up a payment or a reservation. The scripts above stay single.
		async restore(saleId, snapshot) {
			const pipeline = redis
				.multi()
				.del([
					saleKey(saleId, "buyers"),
					saleKey(saleId, "holds"),
					saleKey(saleId, "ids"),
				]);
			if (snapshot.buyers.length > 0) {
				pipeline.sAdd(saleKey(saleId, "buyers"), snapshot.buyers);
			}
			for (const hold of snapshot.holds) {
				pipeline.zAdd(saleKey(saleId, "holds"), {
					score: hold.expiresAt.getTime(),
					value: hold.user,
				});
				pipeline.hSet(saleKey(saleId, "ids"), hold.user, hold.reservationId);
			}
			pipeline.set(saleKey(saleId, "ready"), "1");
			await pipeline.exec();
		},

		// One instance rebuilds a sale at a time. The lock expires by itself, so a dead instance does not hold it.
		async lockRebuild(saleId, ms) {
			const reply = await redis.set(saleKey(saleId, "rebuild-lock"), "1", {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},

		async unlockRebuild(saleId) {
			await redis.del(saleKey(saleId, "rebuild-lock"));
		},
	};
}
