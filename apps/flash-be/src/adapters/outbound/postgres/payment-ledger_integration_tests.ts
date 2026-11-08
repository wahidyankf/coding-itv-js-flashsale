// Integration tests for the payment ledger over Postgres: one charge per reservation however many settles race, a stored
// charge that wins over a decline, and a refund that is safe to repeat.
import { afterAll, beforeEach, expect, it } from "vitest";
import { resetSales } from "../../../bdd/support/seed.js";
import { config } from "../../../config.js";
import { createDb } from "./database.js";
import { createPostgresPaymentLedger } from "./payment-ledger.js";

const db = createDb(config.databaseUrl);
const ledger = createPostgresPaymentLedger(db);
const RACERS = 20;

beforeEach(async () => {
	await resetSales(db);
});

afterAll(async () => {
	await db.destroy();
});

it("keeps one row and one ref when 20 charges of one reservation settle at once", async () => {
	const reservationId = crypto.randomUUID();
	const entries = await Promise.all(
		Array.from({ length: RACERS }, (_, i) =>
			ledger.settle(reservationId, { status: "charged", ref: `mock-${i}` }),
		),
	);
	const refs = new Set(entries.map((entry) => entry.ref));
	expect(refs.size).toBe(1);
	const rows = await db
		.selectFrom("payments")
		.select(["status", "ref", "attempts", "created_by", "updated_by"])
		.where("reservation_id", "=", reservationId)
		.execute();
	expect(rows).toHaveLength(1);
	const system = await db
		.selectFrom("users")
		.select("id")
		.where("username", "=", "$system")
		.executeTakeFirstOrThrow();
	expect(rows[0]).toMatchObject({
		status: "charged",
		attempts: 1,
		created_by: system.id,
		updated_by: null,
	});
	expect(refs.has(rows[0]?.ref ?? "")).toBe(true);
});

it("lets a stored charge win over a decline, and counts a charge after a decline as a second attempt", async () => {
	const declinedFirst = crypto.randomUUID();
	expect(await ledger.settle(declinedFirst, { status: "declined" })).toEqual({
		status: "declined",
		ref: undefined,
		attempts: 1,
	});
	expect(
		await ledger.settle(declinedFirst, { status: "charged", ref: "mock-a" }),
	).toEqual({ status: "charged", ref: "mock-a", attempts: 2 });
	expect(await ledger.settle(declinedFirst, { status: "declined" })).toEqual({
		status: "charged",
		ref: "mock-a",
		attempts: 2,
	});
	expect(await ledger.find(declinedFirst)).toEqual({
		status: "charged",
		ref: "mock-a",
		attempts: 2,
	});
});

it("refunds a charge once, and ignores a second refund and a stale ref", async () => {
	const reservationId = crypto.randomUUID();
	await ledger.settle(reservationId, { status: "charged", ref: "mock-b" });
	expect(await ledger.refund("mock-b")).toBe(true);
	expect(await ledger.refund("mock-b")).toBe(false);
	await ledger.settle(reservationId, { status: "charged", ref: "mock-c" });
	expect(await ledger.refund("mock-b")).toBe(false);
	expect(await ledger.find(reservationId)).toEqual({
		status: "charged",
		ref: "mock-c",
		attempts: 2,
	});
});

it("finds nothing for a reservation that was never settled", async () => {
	expect(await ledger.find(crypto.randomUUID())).toBeUndefined();
});
