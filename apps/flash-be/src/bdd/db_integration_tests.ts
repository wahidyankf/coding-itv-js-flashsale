import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { createDb } from "../db.js";
import { createMigrator } from "../migrator.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";

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
	},
	{ excludeTags: ["integration-exempt"] },
);
