// The seeder over Postgres: the product and the sale are written together, and both ids come back.
import { afterAll, beforeEach, expect, it } from "vitest";
import { resetSales } from "../../../bdd/support/seed.js";
import { config } from "../../../config.js";
import { SYSTEM_USERNAME } from "../../../domain/actors.js";
import { createDb } from "./database.js";
import { createSaleSeeder } from "./sale-seeder.js";
import { actorId } from "./users.js";

const db = createDb(config.databaseUrl);

beforeEach(async () => {
	await resetSales(db);
});

afterAll(async () => {
	await db.destroy();
});

it("stores the product and the sale, and gives back both ids", async () => {
	const stored = await createSaleSeeder(db).seed(
		{
			name: "Seed sale",
			stock: 5,
			startsAt: new Date("2026-06-01T12:00:00Z"),
			endsAt: new Date("2026-06-01T13:00:00Z"),
			holdSeconds: 120,
			admitPerSecond: 50,
		},
		await actorId(db, SYSTEM_USERNAME),
	);

	const row = await db
		.selectFrom("sales")
		.select(["product_id", "stock", "sold"])
		.where("id", "=", stored.id)
		.executeTakeFirstOrThrow();
	expect(row.product_id).toBe(stored.productId);
	expect(row.stock).toBe(5);
	expect(row.sold).toBe(0);
});
