// Binds specs/apps/flash/be/behaviours/db/migrations.feature at the unit layer: the migrations run against a database that only
// records the SQL it is sent, so each Then checks the statements the migrations send. The integration layer checks the same
// scenarios against a real database (db_integration_tests.ts). The two differ on purpose, so the steps stay in each file.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { up as upProducts } from "../adapters/outbound/postgres/migrations/0001_create_products.js";
import { up } from "../adapters/outbound/postgres/migrations/0002_create_sales.js";
import { up as upUsers } from "../adapters/outbound/postgres/migrations/0003_users_products_audit.js";
import { up as upAuth } from "../adapters/outbound/postgres/migrations/0004_auth_sessions.js";
import { SYSTEM_USERNAME } from "../domain/actors.js";
import { specFile } from "./support/paths.js";
import { recordingDb } from "./support/recording-db.js";

// The recording database type the scenarios pass around.
type Recording = ReturnType<typeof recordingDb>;

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

// Runs every migration, in order, on a database that only records.
async function runMigrations(db: Recording): Promise<void> {
	await upProducts(db.db);
	await up(db.db);
	await upUsers(db.db);
	await upAuth(db.db);
}

// A recording database with every migration run on it.
async function migrated(): Promise<Recording> {
	const db = recordingDb();
	await runMigrations(db);
	return db;
}

function sent(db: Recording, pattern: RegExp): boolean {
	return db.queries.some((sql) => pattern.test(sql));
}

// Whether the migrations give the table the column: in its `create table`, or in an `alter table ... add column`.
function hasColumn(db: Recording, table: string, column: string): boolean {
	return (
		sent(db, new RegExp(`create table "${table}" \\([^;]*"${column}" `, "s")) ||
		sent(db, new RegExp(`alter table "${table}" add column "${column}" `))
	);
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The migrations create the sales, purchases, reservations, products, users and sessions tables",
			({ Given, When, Then }) => {
				let db: Recording;

				Given("a database with no tables", () => {
					db = recordingDb();
				});

				When("the migrations run to the latest version", async () => {
					await runMigrations(db);
				});

				Then(
					"the sales, purchases, reservations, products, users and sessions tables exist",
					() => {
						// `sales`, `purchases` and `reservations` are made by the second migration, the others by the third.
						for (const table of TABLES) {
							expect(sent(db, new RegExp(`create table "${table}"`))).toBe(
								true,
							);
						}
					},
				);
			},
		);

		Scenario(
			"Every table records who created, changed and deleted a row",
			({ Given, When, Then }) => {
				let db: Recording;

				Given("a database with no tables", () => {
					db = recordingDb();
				});

				When("the migrations run to the latest version", async () => {
					await runMigrations(db);
				});

				Then(
					"each of those tables has the columns created_at, created_by, updated_at, updated_by, deleted_at and deleted_by",
					() => {
						for (const table of TABLES) {
							for (const column of AUDIT_COLUMNS) {
								expect(hasColumn(db, table, column), `${table}.${column}`).toBe(
									true,
								);
							}
						}
					},
				);
			},
		);

		Scenario(
			"The migrations leave one user, the system, that acts for the migrations",
			({ Given, When, Then }) => {
				let db: Recording;

				Given("a database with no tables", () => {
					db = recordingDb();
				});

				When("the migrations run to the latest version", async () => {
					await runMigrations(db);
				});

				// Without a database, the proof is the SQL the migrations send, not the rows.
				Then(
					"the users table holds only the user {string}",
					(_ctx, system: string) => {
						expect(system).toBe(SYSTEM_USERNAME);
						const inserts = db.statements.filter((statement) =>
							/insert into users/.test(statement.sql),
						);
						expect(inserts[0]?.parameters).toEqual([SYSTEM_USERNAME]);
						const retired = db.statements.find((statement) =>
							/update users set deleted_at = now\(\)/.test(statement.sql),
						);
						expect(retired?.parameters).toEqual([SYSTEM_USERNAME, "$operator"]);
					},
				);
			},
		);

		Scenario(
			"An existing database keeps its data when it is migrated",
			({ Given, And, When, Then }) => {
				let db: Recording;

				Given(
					"a database migrated to the version before users and products",
					() => {
						db = recordingDb();
					},
				);

				And(
					"that database holds a sale named {string} with a hold and a purchase by {string}",
					() => {
						// Nothing to insert: without a database, the proof is the statements the migration sends.
					},
				);

				When("the migrations run to the latest version", async () => {
					await upUsers(db.db);
					await upAuth(db.db);
				});

				// Without a database, the proof is the SQL that moves the old rows to the new tables.
				Then("the sale belongs to a product named {string}", () => {
					expect(
						sent(
							db,
							/insert into products \(id, name, created_at, created_by\)\s+select product_id, name, created_at, created_by from sales/,
						),
					).toBe(true);
				});

				And("the user {string} holds that hold and that purchase", () => {
					expect(
						sent(
							db,
							/insert into users \(username, created_by\)\s+select name, \(select id from users where username = \$1\)\s+from \(select user_id as name from purchases union select user_id from reservations\)/,
						),
					).toBe(true);
					for (const table of ["purchases", "reservations"]) {
						expect(
							sent(
								db,
								new RegExp(`update "${table}" as t set user_uuid = u.id`),
							),
						).toBe(true);
					}
				});
			},
		);

		Scenario(
			"The database refuses a sale that has sold more than its stock",
			({ Given, When, Then }) => {
				let db: Recording;

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
			"The database refuses a sale that has no product",
			({ Given, When, Then }) => {
				let db: Recording;

				Given("a database migrated to the latest version", async () => {
					db = await migrated();
				});

				When("a sale with no product is inserted", async () => {
					await db.db
						.insertInto("sales" as never)
						.values({ stock: 5 } as never)
						.execute();
				});

				// Without a database, the unit proof is the column the migration makes required.
				Then(
					"the database refuses the sale because its product is missing",
					() => {
						expect(
							sent(
								db,
								/alter table "sales" alter column "product_id" set not null/,
							),
						).toBe(true);
					},
				);
			},
		);

		Scenario(
			"The database refuses a user with a role it does not know",
			({ Given, When, Then }) => {
				let db: Recording;

				Given("a database migrated to the latest version", async () => {
					db = await migrated();
				});

				When(
					"a user with the role {string} is inserted",
					async (_ctx, role: string) => {
						await db.db
							.insertInto("users" as never)
							.values({ username: "ana", role } as never)
							.execute();
					},
				);

				// Without a database, the unit proof is the check constraint the migration creates.
				Then(
					"the database refuses the user because its role is unknown",
					() => {
						expect(
							sent(
								db,
								/add constraint users_role_known check \(role in \('shopper', 'operator'\)\)/,
							),
						).toBe(true);
					},
				);
			},
		);

		Scenario(
			"The database refuses a second purchase by the same user in one sale",
			({ Given, And, When, Then }) => {
				let db: Recording;

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

				// Without a database, the unit proof is the live-rows-only unique index the migration creates.
				Then("the database refuses the second purchase", () => {
					expect(
						sent(
							db,
							/create unique index purchases_one_per_user on purchases \(sale_id, user_id\) where deleted_at is null/,
						),
					).toBe(true);
				});
			},
		);
	},
);
