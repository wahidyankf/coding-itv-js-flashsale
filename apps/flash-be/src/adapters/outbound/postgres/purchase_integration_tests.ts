// Integration test for committing a purchase over the dev Postgres: the same reservation gives the same purchase, a shopper
// buys once, the stock is never oversold, and a charge refunded before the commit writes nothing.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { insertSale } from "../../../bdd/support/seed.js";
import { usernameOf } from "../../../bdd/support/users.js";
import { config } from "../../../config.js";
import { createDb } from "./database.js";
import { createPostgresPaymentLedger } from "./payment-ledger.js";
import { createPurchaseRepository } from "./purchase-repository.js";
import { createReservationRepository } from "./reservation-repository.js";

// The three ways a commit can end besides a new purchase, against the real tables.
const db = createDb(config.databaseUrl);
const repository = createPurchaseRepository(db);
const ledger = createPostgresPaymentLedger(db);

afterAll(async () => {
	await db.destroy();
});

async function sale(stock: number) {
	const now = new Date();
	return insertSale(db, {
		stock,
		startsAt: new Date(now.getTime() - 3_600_000),
		endsAt: new Date(now.getTime() + 3_600_000),
	});
}

// A commit of a hold whose charge is in the ledger, as the mock payment leaves it before a commit.
async function input(
	saleId: string,
	user: string,
	reservationId: string = crypto.randomUUID(),
) {
	const paymentRef = `pay-${user}-${crypto.randomUUID()}`;
	await ledger.settle(reservationId, { status: "charged", ref: paymentRef });
	return { saleId, user: usernameOf(user), reservationId, paymentRef };
}

async function soldOf(saleId: string): Promise<number> {
	const row = await db
		.selectFrom("sales")
		.select("sold")
		.where("id", "=", saleId)
		.executeTakeFirstOrThrow();
	return row.sold;
}

describe("committing a purchase", () => {
	it("returns the same purchase for the same reservation, without selling twice", async () => {
		const saleId = await sale(3);
		const request = await input(saleId, "ana");
		const first = await repository.commit(request);
		const second = await repository.commit(request);
		expect(first).toMatchObject({ kind: "purchased", created: true });
		expect(second).toMatchObject({ kind: "purchased", created: false });
		expect(await soldOf(saleId)).toBe(1);
	});

	it("refuses a second purchase by the same user", async () => {
		const saleId = await sale(3);
		await repository.commit(await input(saleId, "ana"));
		expect(await repository.commit(await input(saleId, "ana"))).toEqual({
			kind: "already_purchased",
		});
	});

	it("refuses a purchase when no item is left", async () => {
		const saleId = await sale(1);
		await repository.commit(await input(saleId, "ana"));
		expect(await repository.commit(await input(saleId, "ben"))).toEqual({
			kind: "sold_out",
		});
	});

	// A confirmation that gave up refunded the shared charge before this commit ran. The commit writes nothing, so the
	// shopper keeps the hold and can pay again.
	it("refuses a purchase whose charge was refunded first, and leaves the hold and the stock as they were", async () => {
		const saleId = await sale(3);
		const request = await input(saleId, "ana");
		await createReservationRepository(db).save({
			saleId,
			user: request.user,
			reservationId: request.reservationId,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(await ledger.refund(request.paymentRef)).toBe(true);

		expect(await repository.commit(request)).toEqual({
			kind: "charge_refunded",
		});
		expect(await soldOf(saleId)).toBe(0);
		expect(
			await repository.findReservation(saleId, request.user),
		).toMatchObject({ reservationId: request.reservationId });
		expect(await repository.findByReservation(request.reservationId)).toBe(
			undefined,
		);
	});

	// The refund holds the ledger row and gives the charge back while the commit starts. The commit must wait for the
	// refund to finish and then see the charge as refunded, not read the row as it was before.
	it("waits for a refund that holds the charge, and then refuses the purchase", async () => {
		const saleId = await sale(3);
		const request = await input(saleId, "ana");
		let locked: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			locked = resolve;
		});
		const refund = db.transaction().execute(async (trx) => {
			await sql`select ref from payments where ref = ${request.paymentRef} for update`.execute(
				trx,
			);
			await sql`update payments set status = 'refunded' where ref = ${request.paymentRef}`.execute(
				trx,
			);
			locked();
			await sql`select pg_sleep(0.3)`.execute(trx);
		});
		await holding;
		const committed = await repository.commit(request);
		await refund;
		expect(committed).toEqual({ kind: "charge_refunded" });
		expect(await soldOf(saleId)).toBe(0);
	});
});
