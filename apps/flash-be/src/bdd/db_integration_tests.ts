import { randomUUID } from "node:crypto";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import {
	createDb,
	type Database,
} from "../adapters/outbound/postgres/database.js";
import { createMigrator } from "../adapters/outbound/postgres/migrator.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";
import { insertSale } from "./support/seed.js";

const TABLES = ["sales", "purchases", "reservations"];

const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

// An empty scratch database for one scenario. The scenario migrates it when it needs tables.
async function scratch(): Promise<Kysely<Database>> {
	const { url, drop } = await createScratchDatabase();
	const db = createDb(url);
	cleanups.push(() => db.destroy(), drop);
	return db;
}

async function migrate(db: Kysely<Database>): Promise<void> {
	const { error } = await createMigrator(db).migrateToLatest();
	if (error) throw error;
}

async function exists(db: Kysely<Database>, table: string): Promise<boolean> {
	const result = await sql<{
		name: string | null;
	}>`select to_regclass(${`public.${table}`}) as name`.execute(db);
	return result.rows[0]?.name === table;
}

const WINDOW = {
	startsAt: new Date(Date.now() - 3_600_000),
	endsAt: new Date(Date.now() + 3_600_000),
};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The migrations create the sales, purchases and reservations tables",
			({ Given, When, Then, And }) => {
				let db: Kysely<Database>;

				Given("a database with no tables", async () => {
					db = await scratch();
				});

				When("the migrations run to the latest version", async () => {
					await migrate(db);
				});

				Then("the sales, purchases and reservations tables exist", async () => {
					for (const table of TABLES) {
						expect(await exists(db, table)).toBe(true);
					}
				});

				And("the products table does not exist", async () => {
					expect(await exists(db, "products")).toBe(false);
				});
			},
		);

		Scenario(
			"Rolling back the latest migration restores the products table",
			({ Given, When, Then, And }) => {
				let db: Kysely<Database>;

				Given("a database migrated to the latest version", async () => {
					db = await scratch();
					await migrate(db);
				});

				When("the latest migration is rolled back", async () => {
					const { error } = await createMigrator(db).migrateDown();
					if (error) throw error;
				});

				Then("the products table exists", async () => {
					expect(await exists(db, "products")).toBe(true);
				});

				And(
					"the sales, purchases and reservations tables do not exist",
					async () => {
						for (const table of TABLES) {
							expect(await exists(db, table)).toBe(false);
						}
					},
				);
			},
		);

		Scenario(
			"The database refuses a sale that has sold more than its stock",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;
				let failure: unknown;

				Given("a database migrated to the latest version", async () => {
					db = await scratch();
					await migrate(db);
				});

				When("a sale with stock 5 and 6 sold is inserted", async () => {
					try {
						await insertSale(db, { stock: 5, sold: 6, ...WINDOW });
					} catch (error) {
						failure = error;
					}
				});

				Then("the database refuses the row", () => {
					expect(String((failure as Error | undefined)?.message)).toContain(
						"sales_sold_within_stock",
					);
				});
			},
		);

		Scenario(
			"The database refuses a second purchase by the same user in one sale",
			({ Given, And, When, Then }) => {
				let db: Kysely<Database>;
				let saleId: string;
				let failure: unknown;

				Given("a database migrated to the latest version", async () => {
					db = await scratch();
					await migrate(db);
				});

				And("a sale with stock 5 exists", async () => {
					saleId = await insertSale(db, { stock: 5, ...WINDOW });
				});

				When(
					"the user {string} is recorded as a buyer twice in that sale",
					async (_ctx, user: string) => {
						try {
							for (let attempt = 0; attempt < 2; attempt++) {
								await db
									.insertInto("purchases")
									.values({
										sale_id: saleId,
										user_id: user,
										reservation_id: randomUUID(),
										payment_ref: `pay-${attempt}`,
									})
									.execute();
							}
						} catch (error) {
							failure = error;
						}
					},
				);

				Then("the database refuses the second purchase", () => {
					expect(String((failure as Error | undefined)?.message)).toContain(
						"purchases_one_per_user",
					);
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
