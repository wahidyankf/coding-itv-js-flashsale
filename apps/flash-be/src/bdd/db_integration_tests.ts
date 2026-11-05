import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { createDb } from "../db.js";
import { createMigrator } from "../migrator.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";
import { seedProducts } from "./support/seed.js";

const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The first migration creates the products table",
			({ Given, When, Then }) => {
				let url: string;
				let drop: () => Promise<void>;
				let db: ReturnType<typeof createDb>;

				Given("a database with no tables", async () => {
					({ url, drop } = await createScratchDatabase());
					db = createDb(url);
					cleanups.push(() => db.destroy(), drop);
				});

				When("the migrations run to the latest version", async () => {
					const { error } = await createMigrator(db).migrateToLatest();
					if (error) throw error;
				});

				Then("the products table exists", async () => {
					const result = await sql<{
						name: string | null;
					}>`select to_regclass('public.products') as name`.execute(db);
					expect(result.rows[0]?.name).toBe("products");
				});
			},
		);

		Scenario(
			"Rolling back the first migration removes the products table",
			({ Given, When, Then }) => {
				let url: string;
				let drop: () => Promise<void>;
				let db: ReturnType<typeof createDb>;

				Given("a database migrated to the latest version", async () => {
					({ url, drop } = await createScratchDatabase());
					db = createDb(url);
					cleanups.push(() => db.destroy(), drop);
					const { error } = await createMigrator(db).migrateToLatest();
					if (error) throw error;
				});

				When("the first migration is rolled back", async () => {
					const { error } = await createMigrator(db).migrateDown();
					if (error) throw error;
				});

				Then("the products table does not exist", async () => {
					const result = await sql<{
						name: string | null;
					}>`select to_regclass('public.products') as name`.execute(db);
					expect(result.rows[0]?.name).toBeNull();
				});
			},
		);
		Scenario(
			"A seeded product is stored in the products table",
			({ Given, When, Then }) => {
				let url: string;
				let drop: () => Promise<void>;
				let db: ReturnType<typeof createDb>;

				Given("a database migrated to the latest version", async () => {
					({ url, drop } = await createScratchDatabase());
					db = createDb(url);
					cleanups.push(() => db.destroy(), drop);
					const { error } = await createMigrator(db).migrateToLatest();
					if (error) throw error;
				});

				When('a product named "Flash mug" is seeded', async () => {
					await seedProducts(db, [{ name: "Flash mug" }]);
				});

				Then("the products table holds 1 product", async () => {
					const result = await sql<{
						count: number;
					}>`select count(*)::int as count from products`.execute(db);
					expect(result.rows[0]?.count).toBe(1);
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
