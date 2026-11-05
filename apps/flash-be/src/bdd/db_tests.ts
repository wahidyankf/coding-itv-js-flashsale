import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { Kysely } from "kysely";
import { expect } from "vitest";
import type { Database } from "../db.js";
import { down, up } from "../migrations/0001_create_products.js";
import { specFile } from "./support/paths.js";
import { recordingDb } from "./support/recording-db.js";
import { seedProducts } from "./support/seed.js";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/db/migrations.feature")),
	({ Scenario }) => {
		Scenario(
			"The first migration creates the products table",
			({ Given, When, Then }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database with no tables", () => {
					db = recordingDb();
				});

				When("the migrations run to the latest version", async () => {
					await up(db.db);
				});

				Then("the products table exists", () => {
					expect(
						db.queries.some((sql) => /create table "products"/.test(sql)),
					).toBe(true);
				});
			},
		);

		Scenario(
			"Rolling back the first migration removes the products table",
			({ Given, When, Then }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database migrated to the latest version", async () => {
					db = recordingDb();
					await up(db.db);
					db.queries.length = 0;
				});

				When("the first migration is rolled back", async () => {
					await down(db.db);
				});

				Then("the products table does not exist", () => {
					expect(
						db.queries.some((sql) => /drop table "products"/.test(sql)),
					).toBe(true);
				});
			},
		);

		Scenario(
			"A seeded product is stored in the products table",
			({ Given, When, Then }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database migrated to the latest version", async () => {
					db = recordingDb();
					await up(db.db);
					db.queries.length = 0;
				});

				When('a product named "Flash mug" is seeded', async () => {
					// recordingDb is untyped; the seed is typed against the real schema.
					await seedProducts(db.db as unknown as Kysely<Database>, [
						{ name: "Flash mug" },
					]);
				});

				// Without a database, the unit proof is the statement sent: one insert into products.
				Then("the products table holds 1 product", () => {
					const inserts = db.queries.filter((sql) =>
						/insert into "products"/.test(sql),
					);
					expect(inserts).toHaveLength(1);
				});
			},
		);
	},
);
