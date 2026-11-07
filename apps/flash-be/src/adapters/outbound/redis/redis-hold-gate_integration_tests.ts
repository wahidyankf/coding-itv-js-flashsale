// The Redis hold gate against a real Redis: the rebuild writes the keys the reserve script reads, and only the owner of the
// rebuild lock can release it. Adapter layer (integration test: it needs the dev compose stack).

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { usernameOf } from "../../../bdd/support/users.js";
import { config } from "../../../config.js";
import { createRedis } from "./redis-client.js";
import { createRedisHoldGate } from "./redis-hold-gate.js";
import { saleKey } from "./redis-keys.js";

const redis = await createRedis(config.redisUrl);
const ONE_MINUTE_MS = 60_000;

afterAll(async () => {
	await redis.close();
});

describe("the rebuild of the Redis gate", () => {
	it("writes the buyers, the holds and the ready mark, and drops what the snapshot does not hold", async () => {
		const gate = createRedisHoldGate(redis);
		const saleId = randomUUID();
		const now = Date.now();
		await gate.restore(saleId, {
			buyers: [usernameOf("ana")],
			holds: [
				{
					user: usernameOf("ben"),
					reservationId: "r-ben",
					expiresAt: new Date(now + ONE_MINUTE_MS),
				},
			],
		});
		expect(await redis.sMembers(saleKey(saleId, "buyers"))).toEqual(["ana"]);
		expect(await redis.zScore(saleKey(saleId, "holds"), "ben")).toBe(
			now + ONE_MINUTE_MS,
		);
		expect(await redis.hGet(saleKey(saleId, "ids"), "ben")).toBe("r-ben");
		expect(await redis.get(saleKey(saleId, "ready"))).toBe("1");

		await gate.restore(saleId, { buyers: [], holds: [] });
		expect(await redis.sMembers(saleKey(saleId, "buyers"))).toEqual([]);
		expect(await redis.zCard(saleKey(saleId, "holds"))).toBe(0);
		expect(await redis.hLen(saleKey(saleId, "ids"))).toBe(0);
		expect(await redis.get(saleKey(saleId, "ready"))).toBe("1");
		await redis.del(
			["buyers", "holds", "ids", "ready"].map((part) => saleKey(saleId, part)),
		);
	});
});

describe("the rebuild lock", () => {
	it("is taken by one owner, and a stale owner cannot release it", async () => {
		const gate = createRedisHoldGate(redis);
		const saleId = randomUUID();
		expect(await gate.lockRebuild(saleId, ONE_MINUTE_MS, "owner-a")).toBe(true);
		expect(await gate.lockRebuild(saleId, ONE_MINUTE_MS, "owner-b")).toBe(
			false,
		);

		await gate.unlockRebuild(saleId, "owner-b");
		expect(await redis.get(saleKey(saleId, "rebuild-lock"))).toBe("owner-a");

		await gate.unlockRebuild(saleId, "owner-a");
		expect(await redis.get(saleKey(saleId, "rebuild-lock"))).toBeNull();
	});
});
