import { afterAll, describe, expect, it } from "vitest";
import { insertSale } from "../bdd/support/seed.js";
import { config } from "../config.js";
import { createDb } from "../db.js";
import { createRedis } from "../redis.js";
import { createRedisHoldGate } from "./redis-hold-gate.js";
import { createReservationRepository } from "./reservation-repository.js";

// A rebuild must also bring back the buyers, not only the holds. No scenario buys yet at this layer, so this test
// writes a purchase row directly and rebuilds a real Redis from it.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);

afterAll(async () => {
	await redis.close();
	await db.destroy();
});

describe("the rebuild from Postgres", () => {
	it("restores the buyers, so a buyer cannot reserve again", async () => {
		const now = new Date();
		const saleId = await insertSale(db, {
			stock: 3,
			sold: 1,
			startsAt: new Date(now.getTime() - 3_600_000),
			endsAt: new Date(now.getTime() + 3_600_000),
		});
		await db
			.insertInto("purchases")
			.values({
				sale_id: saleId,
				user_id: "ana",
				reservation_id: crypto.randomUUID(),
				payment_ref: "pay-1",
			})
			.execute();

		const gate = createRedisHoldGate(redis);
		const repository = createReservationRepository(db);
		await repository.rebuild(saleId, now, (snapshot) =>
			gate.restore(saleId, snapshot),
		);

		const request = {
			saleId,
			reservationId: crypto.randomUUID(),
			now,
			expiresAt: new Date(now.getTime() + 60_000),
			stock: 3,
		};
		expect(await gate.reserve({ ...request, user: "ana" })).toEqual({
			kind: "purchased",
		});
		// The buyer takes one of the three items, so two holds fit and the third does not.
		expect((await gate.reserve({ ...request, user: "ben" })).kind).toBe(
			"reserved",
		);
		expect((await gate.reserve({ ...request, user: "cai" })).kind).toBe(
			"reserved",
		);
		expect((await gate.reserve({ ...request, user: "dan" })).kind).toBe(
			"sold_out",
		);
	});
});
