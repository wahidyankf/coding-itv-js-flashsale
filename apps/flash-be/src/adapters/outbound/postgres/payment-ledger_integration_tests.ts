// Integration tests for the payment ledger over Postgres: one charge per reservation however many settles race, a stored
// charge that wins over a decline, and a refund that is safe to repeat.
import { sql } from "kysely";
import { afterAll, beforeEach, expect, it } from "vitest";
import {
	insertPurchase,
	insertSale,
	resetSales,
} from "../../../bdd/support/seed.js";
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

// A confirmation whose commit threw refunds its charge, while a confirmation of the same hold on another instance commits a
// purchase with that same ref. The refund must not take back the charge of a live purchase.
it("keeps a charge whose ref a live purchase holds, so a refund cannot take it back", async () => {
	const reservationId = crypto.randomUUID();
	await ledger.settle(reservationId, { status: "charged", ref: "mock-held" });
	const saleId = await insertSale(db, {
		stock: 5,
		startsAt: new Date(Date.now() - 3_600_000),
		endsAt: new Date(Date.now() + 3_600_000),
	});
	await insertPurchase(db, {
		saleId,
		user: "ana",
		reservationId,
		paymentRef: "mock-held",
	});
	expect(await ledger.refund("mock-held")).toBe(false);
	expect((await ledger.find(reservationId))?.status).toBe("charged");
});

// The other order of the same race: the commit holds the ledger row and writes its purchase, and the refund waits for it.
// The refund must see the purchase once the commit is done, so the charge stays.
it("leaves a charge alone when a commit holding its row writes the purchase while the refund waits", async () => {
	const reservationId = crypto.randomUUID();
	await ledger.settle(reservationId, { status: "charged", ref: "mock-raced" });
	const saleId = await insertSale(db, {
		stock: 5,
		startsAt: new Date(Date.now() - 3_600_000),
		endsAt: new Date(Date.now() + 3_600_000),
	});
	let locked: () => void = () => {};
	const holding = new Promise<void>((resolve) => {
		locked = resolve;
	});
	const commit = db.transaction().execute(async (trx) => {
		await sql`select ref from payments where ref = ${"mock-raced"} for share`.execute(
			trx,
		);
		locked();
		await insertPurchase(trx, {
			saleId,
			user: "ana",
			reservationId,
			paymentRef: "mock-raced",
		});
		await sql`select pg_sleep(0.3)`.execute(trx);
	});
	await holding;
	const refunded = await ledger.refund("mock-raced");
	await commit;
	expect(refunded).toBe(false);
	expect((await ledger.find(reservationId))?.status).toBe("charged");
});

it("finds nothing for a reservation that was never settled", async () => {
	expect(await ledger.find(crypto.randomUUID())).toBeUndefined();
});
