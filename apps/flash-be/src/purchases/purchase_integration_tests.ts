import { afterAll, describe, expect, it } from "vitest";
import { insertSale } from "../bdd/support/seed.js";
import { config } from "../config.js";
import { createDb } from "../db.js";
import { createPurchaseRepository } from "./purchase-repository.js";

// The three ways a commit can end besides a new purchase, against the real tables.
const db = createDb(config.databaseUrl);
const repository = createPurchaseRepository(db);

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

const input = (
	saleId: string,
	user: string,
	reservationId = crypto.randomUUID(),
) => ({
	saleId,
	user,
	reservationId,
	paymentRef: `pay-${user}`,
});

describe("committing a purchase", () => {
	it("returns the same purchase for the same reservation, without selling twice", async () => {
		const saleId = await sale(3);
		const request = input(saleId, "ana");
		const first = await repository.commit(request);
		const second = await repository.commit(request);
		expect(first).toMatchObject({ kind: "purchased", created: true });
		expect(second).toMatchObject({ kind: "purchased", created: false });
		const row = await db
			.selectFrom("sales")
			.select("sold")
			.where("id", "=", saleId)
			.executeTakeFirstOrThrow();
		expect(row.sold).toBe(1);
	});

	it("refuses a second purchase by the same user", async () => {
		const saleId = await sale(3);
		await repository.commit(input(saleId, "ana"));
		expect(await repository.commit(input(saleId, "ana"))).toEqual({
			kind: "already_purchased",
		});
	});

	it("refuses a purchase when no item is left", async () => {
		const saleId = await sale(1);
		await repository.commit(input(saleId, "ana"));
		expect(await repository.commit(input(saleId, "ben"))).toEqual({
			kind: "sold_out",
		});
	});
});
