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

describe("the reservation without Redis", () => {
	const repository = createReservationRepository(db);
	const down = async () => false;

	async function openSale(stock: number, sold = 0) {
		const now = new Date();
		return insertSale(db, {
			stock,
			sold,
			startsAt: new Date(now.getTime() - 3_600_000),
			endsAt: new Date(now.getTime() + 3_600_000),
		});
	}

	function requestFor(saleId: string, user: string, stock: number) {
		const now = new Date();
		return {
			saleId,
			user,
			reservationId: crypto.randomUUID(),
			now,
			expiresAt: new Date(now.getTime() + 60_000),
			stock,
		};
	}

	it("leaves the decision to Redis when Redis is ready again", async () => {
		const saleId = await openSale(2);
		const request = requestFor(saleId, "ana", 2);
		expect(
			await repository.reserveWithoutRedis(request, async () => true),
		).toEqual({ kind: "redis_ready" });
		const rows = await db
			.selectFrom("reservations")
			.select("id")
			.where("sale_id", "=", saleId)
			.execute();
		expect(rows).toHaveLength(0);
	});

	it("treats a Redis that fails the readiness check as down", async () => {
		const saleId = await openSale(2);
		const answer = await repository.reserveWithoutRedis(
			requestFor(saleId, "ana", 2),
			async () => {
				throw new Error("redis is down");
			},
		);
		expect(answer.kind).toBe("reserved");
	});

	it("tells a buyer they bought", async () => {
		const saleId = await openSale(3, 1);
		await db
			.insertInto("purchases")
			.values({
				sale_id: saleId,
				user_id: "ana",
				reservation_id: crypto.randomUUID(),
				payment_ref: "pay-1",
			})
			.execute();
		expect(
			await repository.reserveWithoutRedis(requestFor(saleId, "ana", 3), down),
		).toEqual({ kind: "purchased" });
	});

	it("counts sold items and live holds of others, and gives an expired hold back", async () => {
		const saleId = await openSale(2, 1);
		const first = requestFor(saleId, "ben", 2);
		expect((await repository.reserveWithoutRedis(first, down)).kind).toBe(
			"reserved",
		);
		expect((await repository.reserveWithoutRedis(first, down)).kind).toBe(
			"held",
		);
		expect(
			await repository.reserveWithoutRedis(requestFor(saleId, "cai", 2), down),
		).toEqual({ kind: "sold_out" });

		await db
			.updateTable("reservations")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("sale_id", "=", saleId)
			.execute();
		expect(
			(await repository.reserveWithoutRedis(requestFor(saleId, "cai", 2), down))
				.kind,
		).toBe("reserved");
		// The expired row of the first user is replaced in place, not duplicated.
		const again = await repository.reserveWithoutRedis(
			requestFor(saleId, "ben", 2),
			down,
		);
		expect(again.kind).toBe("sold_out");
	});
});
