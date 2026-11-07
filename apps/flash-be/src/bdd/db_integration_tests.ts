// Binds specs/apps/flash/be/behaviours/db/migrations.feature at the integration layer: the migrations run against an empty
// scratch database, and each scenario queries it. The unit layer checks the same scenarios against the SQL the migrations
// send (db_tests.ts). The two differ on purpose, so the steps stay in each file.
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
import { SYSTEM_USERNAME } from "../domain/actors.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";
import { insertPurchase, insertSale } from "./support/seed.js";

const TABLES = [
	"sales",
	"purchases",
	"reservations",
	"products",
	"users",
	"sessions",
];
const AUDIT_COLUMNS = [
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
	"deleted_at",
	"deleted_by",
];

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

// A scratch database with every migration run on it, for a scenario that needs the tables.
async function scratchMigrated(): Promise<Kysely<Database>> {
	const db = await scratch();
	await migrate(db);
	return db;
}

async function exists(db: Kysely<Database>, table: string): Promise<boolean> {
	const result = await sql<{
		name: string | null;
	}>`select to_regclass(${`public.${table}`}) as name`.execute(db);
	return result.rows[0]?.name === table;
}

// The message of the error an attempt raises, or "" when it succeeds, so a scenario checks which constraint refused it.
async function refusalOf(attempt: () => Promise<unknown>): Promise<string> {
	try {
		await attempt();
		return "";
	} catch (error) {
		return String((error as Error).message);
	}
}

const WINDOW = {
	startsAt: new Date(Date.now() - 3_600_000),
	endsAt: new Date(Date.now() + 3_600_000),
};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The migrations create the sales, purchases, reservations, products, users and sessions tables",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;

				Given("a database with no tables", async () => {
					db = await scratch();
				});

				When("the migrations run to the latest version", async () => {
					await migrate(db);
				});

				Then(
					"the sales, purchases, reservations, products, users and sessions tables exist",
					async () => {
						for (const table of TABLES) {
							expect(await exists(db, table)).toBe(true);
						}
					},
				);
			},
		);

		Scenario(
			"Every table records who created, changed and deleted a row",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;

				Given("a database with no tables", async () => {
					db = await scratch();
				});

				When("the migrations run to the latest version", async () => {
					await migrate(db);
				});

				Then(
					"each of those tables has the columns created_at, created_by, updated_at, updated_by, deleted_at and deleted_by",
					async () => {
						for (const table of TABLES) {
							const result = await sql<{
								name: string;
							}>`select column_name as name from information_schema.columns where table_name = ${table}`.execute(
								db,
							);
							const names = result.rows.map((row) => row.name);
							for (const column of AUDIT_COLUMNS) {
								expect(names, `${table}.${column}`).toContain(column);
							}
						}
					},
				);
			},
		);

		Scenario(
			"The migrations leave one user, the system, that acts for the migrations",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;

				Given("a database with no tables", async () => {
					db = await scratch();
				});

				When("the migrations run to the latest version", async () => {
					await migrate(db);
				});

				Then(
					"the users table holds only the user {string}",
					async (_ctx, system: string) => {
						const rows = await db
							.selectFrom("users")
							.select(["id", "username", "created_by"])
							.where("deleted_at", "is", null)
							.execute();
						expect(rows.map((row) => row.username)).toEqual([system]);
						expect(system).toBe(SYSTEM_USERNAME);
						// The system is its own author.
						expect(rows[0]?.created_by).toBe(rows[0]?.id);
						// The stand-in operator of the first migration is kept as a row marked deleted by the system.
						const retired = await db
							.selectFrom("users")
							.select("deleted_by")
							.where("username", "=", "$operator")
							.where("deleted_at", "is not", null)
							.executeTakeFirst();
						expect(retired?.deleted_by).toBe(rows[0]?.id);
					},
				);
			},
		);

		Scenario(
			"An existing database keeps its data when it is migrated",
			({ Given, And, When, Then }) => {
				let db: Kysely<Database>;

				Given(
					"a database migrated to the version before users and products",
					async () => {
						db = await scratch();
						const { error } =
							await createMigrator(db).migrateTo("0002_create_sales");
						if (error) throw error;
					},
				);

				// The old schema has no `product_id` and keeps the user as text, so this is SQL.
				And(
					"that database holds a sale named {string} with a hold and a purchase by {string}",
					async (_ctx, name: string, user: string) => {
						const sale = await sql<{
							id: string;
						}>`insert into sales (name, starts_at, ends_at, stock, sold)
							values (${name}, now() - interval '1 hour', now() + interval '1 hour', 5, 1) returning id`.execute(
							db,
						);
						const saleId = sale.rows[0]?.id;
						await sql`insert into reservations (sale_id, user_id, expires_at)
							values (${saleId}, ${user}, now() + interval '1 minute')`.execute(
							db,
						);
						await sql`insert into purchases (sale_id, user_id, reservation_id, payment_ref)
							values (${saleId}, ${user}, gen_random_uuid(), 'pay-old')`.execute(
							db,
						);
					},
				);

				When("the migrations run to the latest version", async () => {
					await migrate(db);
				});

				Then(
					"the sale belongs to a product named {string}",
					async (_ctx, name: string) => {
						const rows = await db
							.selectFrom("sales")
							.innerJoin("products", "products.id", "sales.product_id")
							.select("products.name")
							.execute();
						expect(rows.map((row) => row.name)).toEqual([name]);
					},
				);

				And(
					"the user {string} holds that hold and that purchase",
					async (_ctx, user: string) => {
						const owner = await db
							.selectFrom("users")
							.select("id")
							.where("username", "=", user)
							.executeTakeFirstOrThrow();
						const hold = await db
							.selectFrom("reservations")
							.select(["user_id", "created_by"])
							.executeTakeFirstOrThrow();
						const purchase = await db
							.selectFrom("purchases")
							.select(["user_id", "created_by"])
							.executeTakeFirstOrThrow();
						expect(hold).toEqual({ user_id: owner.id, created_by: owner.id });
						expect(purchase).toEqual({
							user_id: owner.id,
							created_by: owner.id,
						});
					},
				);
			},
		);

		Scenario(
			"The database refuses a sale that has sold more than its stock",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;
				let refusal: string;

				Given("a database migrated to the latest version", async () => {
					db = await scratchMigrated();
				});

				When("a sale with stock 5 and 6 sold is inserted", async () => {
					refusal = await refusalOf(() =>
						insertSale(db, { stock: 5, sold: 6, ...WINDOW }),
					);
				});

				Then("the database refuses the row", () => {
					expect(refusal).toContain("sales_sold_within_stock");
				});
			},
		);

		Scenario(
			"The database refuses a sale that has no product",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;
				let refusal: string;

				Given("a database migrated to the latest version", async () => {
					db = await scratchMigrated();
				});

				When("a sale with no product is inserted", async () => {
					refusal = await refusalOf(() =>
						sql`insert into sales (name, starts_at, ends_at, stock, created_by)
							values ('Flash sale', now(), now() + interval '1 hour', 5,
								(select id from users where username = ${SYSTEM_USERNAME}))`.execute(
							db,
						),
					);
				});

				Then(
					"the database refuses the sale because its product is missing",
					() => {
						expect(refusal).toContain("product_id");
					},
				);
			},
		);

		Scenario(
			"The database refuses a user with a role it does not know",
			({ Given, When, Then }) => {
				let db: Kysely<Database>;
				let refusal: string;

				Given("a database migrated to the latest version", async () => {
					db = await scratchMigrated();
				});

				When(
					"a user with the role {string} is inserted",
					async (_ctx, role: string) => {
						refusal = await refusalOf(() =>
							sql`insert into users (username, role, created_by)
								values ('ana', ${role}, (select id from users where username = ${SYSTEM_USERNAME}))`.execute(
								db,
							),
						);
					},
				);

				Then(
					"the database refuses the user because its role is unknown",
					() => {
						expect(refusal).toContain("users_role_known");
					},
				);
			},
		);

		Scenario(
			"The database refuses a second purchase by the same user in one sale",
			({ Given, And, When, Then }) => {
				let db: Kysely<Database>;
				let saleId: string;
				let refusal: string;

				Given("a database migrated to the latest version", async () => {
					db = await scratchMigrated();
				});

				And("a sale with stock 5 exists", async () => {
					saleId = await insertSale(db, { stock: 5, ...WINDOW });
				});

				When(
					"the user {string} is recorded as a buyer twice in that sale",
					async (_ctx, user: string) => {
						refusal = await refusalOf(async () => {
							for (let attempt = 0; attempt < 2; attempt++) {
								await insertPurchase(db, {
									saleId,
									user,
									reservationId: randomUUID(),
									paymentRef: `pay-${attempt}`,
								});
							}
						});
					},
				);

				Then("the database refuses the second purchase", () => {
					expect(refusal).toContain("purchases_one_per_user");
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
