// Binds specs/apps/flash/be/behaviours/sale/seeding.feature at the integration layer: the seed writes into a scratch database
// that is migrated to the latest version, and each scenario reads the rows back. The unit layer checks the same scenarios
// against the one insert the seed sends (seeding_tests.ts). The two differ on purpose, so the steps stay in each file.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { parseSeedArgs } from "../adapters/inbound/cli/seed-args.js";
import {
	createDb,
	type Database,
} from "../adapters/outbound/postgres/database.js";
import { createMigrator } from "../adapters/outbound/postgres/migrator.js";
import { seedSale } from "../adapters/outbound/postgres/sale-seeder.js";
import { actorId } from "../adapters/outbound/postgres/users.js";
import { SYSTEM_USERNAME } from "../domain/actors.js";
import { specFile } from "./support/paths.js";
import { createScratchDatabase } from "./support/scratch-db.js";

const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

// An empty scratch database, migrated to the latest version.
async function seededDatabase(): Promise<Kysely<Database>> {
	const { url, drop } = await createScratchDatabase();
	const scratch = createDb(url);
	cleanups.push(() => scratch.destroy(), drop);
	const { error } = await createMigrator(scratch).migrateToLatest();
	if (error) throw error;
	return scratch;
}

function seedArgs(stock: number, startsIn: number, duration: number): string[] {
	return [
		"--stock",
		String(stock),
		"--starts-in-minutes",
		String(startsIn),
		"--duration-minutes",
		String(duration),
	];
}

// Uses the same parse-then-write path as the CLI, so the scenario tests what operators run.
async function seedFrom(
	scratch: Kysely<Database>,
	stock: number,
	startsIn: number,
	duration: number,
): Promise<void> {
	const parsed = parseSeedArgs(seedArgs(stock, startsIn, duration), new Date());
	if (parsed.isErr()) throw new Error(parsed.error);
	await seedSale(
		scratch,
		parsed.value,
		await actorId(scratch, SYSTEM_USERNAME),
	);
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/seeding.feature")),
	({ Scenario }) => {
		Scenario(
			"Seeding creates a sale with the given stock and window",
			({ Given, When, Then, And }) => {
				let scratch: Kysely<Database>;

				Given("a database migrated to the latest version", async () => {
					scratch = await seededDatabase();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						await seedFrom(scratch, stock, startsIn, duration);
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
				let scratch: Kysely<Database>;
				let failure: unknown;

				Given("a database migrated to the latest version", async () => {
					scratch = await seededDatabase();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						try {
							await seedFrom(scratch, stock, startsIn, duration);
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
