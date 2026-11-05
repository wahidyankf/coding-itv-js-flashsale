import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { createDb } from "../db.js";
import { createMigrator } from "../migrator.js";
import { parseSeedArgs, seedSale } from "../sales/seed.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";

const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/seeding.feature")),
	({ Scenario }) => {
		async function seededDatabase() {
			const { url, drop } = await createScratchDatabase();
			const scratch = createDb(url);
			cleanups.push(() => scratch.destroy(), drop);
			const { error } = await createMigrator(scratch).migrateToLatest();
			if (error) throw error;
			return scratch;
		}

		const args = (stock: number, startsIn: number, duration: number) => [
			"--stock",
			String(stock),
			"--starts-in-minutes",
			String(startsIn),
			"--duration-minutes",
			String(duration),
		];

		Scenario(
			"Seeding creates a sale with the given stock and window",
			({ Given, When, Then, And }) => {
				let scratch: Awaited<ReturnType<typeof seededDatabase>>;

				Given("a database migrated to the latest version", async () => {
					scratch = await seededDatabase();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						await seedSale(
							scratch,
							parseSeedArgs(args(stock, startsIn, duration), new Date()),
						);
					},
				);

				Then(
					"the sales table holds {int} sale with stock {int}",
					async (_ctx, count: number, stock: number) => {
						const rows = await scratch
							.selectFrom("sales")
							.selectAll()
							.execute();
						expect(rows).toHaveLength(count);
						expect(rows[0]?.stock).toBe(stock);
					},
				);

				And(
					"that sale is open for {int} minutes",
					async (_ctx, minutes: number) => {
						const result = await sql<{
							minutes: number;
						}>`select extract(epoch from (ends_at - starts_at)) / 60 as minutes from sales`.execute(
							scratch,
						);
						expect(Number(result.rows[0]?.minutes)).toBe(minutes);
					},
				);
			},
		);

		Scenario(
			"Seeding refuses a stock that is not a positive integer",
			({ Given, When, Then, And }) => {
				let scratch: Awaited<ReturnType<typeof seededDatabase>>;
				let failure: unknown;

				Given("a database migrated to the latest version", async () => {
					scratch = await seededDatabase();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						try {
							await seedSale(
								scratch,
								parseSeedArgs(args(stock, startsIn, duration), new Date()),
							);
						} catch (error) {
							failure = error;
						}
					},
				);

				Then("seeding fails with {string}", (_ctx, message: string) => {
					expect((failure as Error | undefined)?.message).toBe(message);
				});

				And(
					"the sales table holds {int} sales",
					async (_ctx, count: number) => {
						const rows = await scratch
							.selectFrom("sales")
							.selectAll()
							.execute();
						expect(rows).toHaveLength(count);
					},
				);
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
