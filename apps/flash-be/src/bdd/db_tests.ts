import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { up as upProducts } from "../adapters/outbound/postgres/migrations/0001_create_products.js";
import { up } from "../adapters/outbound/postgres/migrations/0002_create_sales.js";
import { specFile } from "./support/paths.js";
import { recordingDb } from "./support/recording-db.js";

const TABLES = ["sales", "purchases", "reservations"];

// Runs every migration, in order, against a database that only records.
async function migrated(): Promise<ReturnType<typeof recordingDb>> {
	const db = recordingDb();
	await upProducts(db.db);
	await up(db.db);
	return db;
}

function sent(db: ReturnType<typeof recordingDb>, pattern: RegExp): boolean {
	return db.queries.some((sql) => pattern.test(sql));
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The migrations create the sales, purchases and reservations tables",
			({ Given, When, Then, And }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database with no tables", () => {
					db = recordingDb();
				});

				When("the migrations run to the latest version", async () => {
					await upProducts(db.db);
					await up(db.db);
				});

				Then("the sales, purchases and reservations tables exist", () => {
					for (const table of TABLES) {
						expect(sent(db, new RegExp(`create table "${table}"`))).toBe(true);
					}
				});

				And("the products table does not exist", () => {
					expect(sent(db, /drop table "products"/)).toBe(true);
				});
			},
		);

		Scenario(
			"The database refuses a sale that has sold more than its stock",
			({ Given, When, Then }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database migrated to the latest version", async () => {
					db = await migrated();
				});

				When("a sale with stock 5 and 6 sold is inserted", async () => {
					await db.db
						.insertInto("sales" as never)
						.values({ stock: 5, sold: 6 } as never)
						.execute();
				});

				// Without a database, the unit proof is the constraint the migration creates.
				Then("the database refuses the row", () => {
					expect(
						sent(
							db,
							/constraint "sales_sold_within_stock" check \(sold <= stock\)/,
						),
					).toBe(true);
				});
			},
		);

		Scenario(
			"The database refuses a second purchase by the same user in one sale",
			({ Given, And, When, Then }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database migrated to the latest version", async () => {
					db = await migrated();
				});

				And("a sale with stock 5 exists", async () => {
					await db.db
						.insertInto("sales" as never)
						.values({ stock: 5 } as never)
						.execute();
				});

				When(
					"the user {string} is recorded as a buyer twice in that sale",
					async (_ctx, user: string) => {
						for (const reservation of ["r1", "r2"]) {
							await db.db
								.insertInto("purchases" as never)
								.values({ user_id: user, reservation_id: reservation } as never)
								.execute();
						}
					},
				);

				// Without a database, the unit proof is the constraint the migration creates.
				Then("the database refuses the second purchase", () => {
					expect(
						sent(
							db,
							/constraint "purchases_one_per_user" unique \("sale_id", "user_id"\)/,
						),
					).toBe(true);
				});
			},
		);
	},
);
