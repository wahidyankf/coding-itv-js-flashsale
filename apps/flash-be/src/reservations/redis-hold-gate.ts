import type { RedisClient } from "../redis.js";
import type { GateAnswer, HoldGate } from "./hold-gate.js";

const key = (saleId: string, name: string) => `sale:${saleId}:${name}`;

// KEYS: ready, buyers, holds, ids. ARGV: user, now, expiresAt, stock, reservationId.
// Replies: {0} sold out, {1, id, expiresAt} reserved, {2} bought, {3, id, expiresAt} already holding, {4} not ready.
// One script means the count and the add cannot be split by another request, so the stock is never exceeded.
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

export function createRedisHoldGate(redis: RedisClient): HoldGate {
	return {
		async reserve(request) {
			const reply = (await redis.eval(RESERVE, {
				keys: [
					key(request.saleId, "ready"),
					key(request.saleId, "buyers"),
					key(request.saleId, "holds"),
					key(request.saleId, "ids"),
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
				0: { kind: "sold_out" },
				1: { kind: "reserved", ...answer },
				2: { kind: "purchased" },
				3: { kind: "held", ...answer },
				4: { kind: "not_ready" },
			};
			return answers[Number(code)] as GateAnswer;
		},

		async release(saleId, user) {
			await redis
				.multi()
				.zRem(key(saleId, "holds"), user)
				.hDel(key(saleId, "ids"), user)
				.exec();
		},

		async confirm(saleId, user) {
			await redis
				.multi()
				.sAdd(key(saleId, "buyers"), user)
				.zRem(key(saleId, "holds"), user)
				.hDel(key(saleId, "ids"), user)
				.exec();
		},

		async isReady(saleId) {
			return (await redis.exists(key(saleId, "ready"))) === 1;
		},

		async invalidate(saleId) {
			await redis.del(key(saleId, "ready"));
		},

		async restore(saleId, snapshot) {
			const pipeline = redis
				.multi()
				.del([key(saleId, "buyers"), key(saleId, "holds"), key(saleId, "ids")]);
			if (snapshot.buyers.length > 0) {
				pipeline.sAdd(key(saleId, "buyers"), snapshot.buyers);
			}
			for (const hold of snapshot.holds) {
				pipeline.zAdd(key(saleId, "holds"), {
					score: hold.expiresAt.getTime(),
					value: hold.user,
				});
				pipeline.hSet(key(saleId, "ids"), hold.user, hold.reservationId);
			}
			pipeline.set(key(saleId, "ready"), "1");
			await pipeline.exec();
		},

		async lockRebuild(saleId, ms) {
			const reply = await redis.set(key(saleId, "rebuild-lock"), "1", {
				condition: "NX",
				expiration: { type: "PX", value: ms },
			});
			return reply === "OK";
		},

		async unlockRebuild(saleId) {
			await redis.del(key(saleId, "rebuild-lock"));
		},
	};
}
