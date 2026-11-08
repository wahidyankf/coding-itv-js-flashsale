// Integration tests for the Postgres reservation repository (adapter layer, outbound), over the dev database. Each decision
// runs under the sale row lock, so these check the order the lock gives.

import type { Result } from "@flash/typekit";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import type { UnreadableReply } from "../../application/ports/reply.js";
import { insertPurchase, insertSale } from "../../bdd/support/seed.js";
import { usernameOf } from "../../bdd/support/users.js";
import { config } from "../../config.js";
import type { GateAnswer, HoldSnapshot } from "../../domain/reservation.js";
import { createDb } from "./postgres/database.js";
import { createReservationRepository } from "./postgres/reservation-repository.js";
import { createRedis } from "./redis/redis-client.js";
import { createRedisHoldGate } from "./redis/redis-hold-gate.js";

// The gate answers as a value. An unreadable answer fails the test with its reason, so each expectation reads the answer.
async function answered(
	reply: Promise<Result<GateAnswer, UnreadableReply>>,
): Promise<GateAnswer> {
	const result = await reply;
	if (result.isErr()) throw new Error(`unreadable gate reply: ${result.error}`);
	return result.value;
}

// A rebuild must also bring back the buyers, not only the holds. No scenario reaches a purchase at this layer, so this
// test writes a purchase row directly and rebuilds a real Redis from it.
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
		await insertPurchase(db, { saleId, user: usernameOf("ana") });

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
		expect(
			await answered(gate.reserve({ ...request, user: usernameOf("ana") })),
		).toEqual({
			kind: "purchased",
		});
		// The buyer takes one of the three items, so two holds fit and the third does not.
		expect(
			(await answered(gate.reserve({ ...request, user: usernameOf("ben") })))
				.kind,
		).toBe("reserved");
		expect(
			(await answered(gate.reserve({ ...request, user: usernameOf("cai") })))
				.kind,
		).toBe("reserved");
		expect(
			(await answered(gate.reserve({ ...request, user: usernameOf("dan") })))
				.kind,
		).toBe("sold_out");
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
			user: usernameOf(user),
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
			await repository.reserveWithoutGate(request, async () => true),
		).toEqual({ kind: "gate_ready" });
		const rows = await db
			.selectFrom("reservations")
			.select("id")
			.where("sale_id", "=", saleId)
			.execute();
		expect(rows).toHaveLength(0);
	});

	it("treats a Redis that fails the readiness check as down", async () => {
		const saleId = await openSale(2);
		const answer = await repository.reserveWithoutGate(
			requestFor(saleId, "ana", 2),
			async () => {
				throw new Error("redis is down");
			},
		);
		expect(answer.kind).toBe("reserved");
	});

	it("tells a buyer they bought", async () => {
		const saleId = await openSale(3, 1);
		await insertPurchase(db, { saleId, user: usernameOf("ana") });
		expect(
			await repository.reserveWithoutGate(requestFor(saleId, "ana", 3), down),
		).toEqual({ kind: "purchased" });
	});

	it("counts sold items and live holds of others, and gives an expired hold back", async () => {
		const saleId = await openSale(2, 1);
		const first = requestFor(saleId, "ben", 2);
		expect((await repository.reserveWithoutGate(first, down)).kind).toBe(
			"reserved",
		);
		expect((await repository.reserveWithoutGate(first, down)).kind).toBe(
			"held",
		);
		expect(
			await repository.reserveWithoutGate(requestFor(saleId, "cai", 2), down),
		).toEqual({ kind: "sold_out" });

		await db
			.updateTable("reservations")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("sale_id", "=", saleId)
			.execute();
		expect(
			(await repository.reserveWithoutGate(requestFor(saleId, "cai", 2), down))
				.kind,
		).toBe("reserved");
		// The expired row of the first user is replaced in place, not duplicated.
		const again = await repository.reserveWithoutGate(
			requestFor(saleId, "ben", 2),
			down,
		);
		expect(again.kind).toBe("sold_out");
	});
});

describe("a sale removed while a request runs", () => {
	it("answers sale_not_found as a value, not a failure", async () => {
		const db2 = createDb(config.databaseUrl);
		try {
			const now = new Date();
			const saleId = await insertSale(db2, {
				stock: 2,
				startsAt: new Date(now.getTime() - 3_600_000),
				endsAt: new Date(now.getTime() + 3_600_000),
			});
			await db2
				.updateTable("sales")
				.set({ deleted_at: sql<Date>`now()` })
				.where("id", "=", saleId)
				.execute();
			const answer = await createReservationRepository(db2).reserveWithoutGate(
				{
					saleId,
					user: usernameOf("ana"),
					reservationId: crypto.randomUUID(),
					now,
					expiresAt: new Date(now.getTime() + 60_000),
					stock: 2,
				},
				async () => false,
			);
			expect(answer).toEqual({ kind: "sale_not_found" });
		} finally {
			await db2.destroy();
		}
	});
});

describe("the rebuild leaves out removed users, as the live checks do", () => {
	it("gives no buyer and no hold of a removed user to the gate", async () => {
		const now = new Date();
		const saleId = await insertSale(db, {
			stock: 3,
			startsAt: new Date(now.getTime() - 3_600_000),
			endsAt: new Date(now.getTime() + 3_600_000),
		});
		const buyer = `gone-buyer-${crypto.randomUUID()}`;
		const holder = `gone-holder-${crypto.randomUUID()}`;
		await insertPurchase(db, { saleId, user: buyer });
		await createReservationRepository(db).save({
			saleId,
			user: usernameOf(holder),
			reservationId: crypto.randomUUID(),
			expiresAt: new Date(now.getTime() + 60_000),
		});
		await db
			.updateTable("users")
			.set({ deleted_at: sql<Date>`now()` })
			.where("username", "in", [buyer, holder])
			.execute();

		let snapshot: HoldSnapshot | undefined;
		await createReservationRepository(db).rebuild(
			saleId,
			now,
			async (found) => {
				snapshot = found;
			},
		);
		expect(snapshot).toEqual({ buyers: [], holds: [] });
	});
});
