// Binds specs/apps/flash/be/behaviours/sale/seeding.feature at the unit layer: the seed writes into a recording database, so each
// Then checks the one insert the seed sends and its values. The integration layer checks the same scenarios against a real
// database (seeding_integration_tests.ts). The two differ on purpose, so the steps stay in each file.
import {
	describeFeature,
	loadFeature,
	type StepTest,
} from "@amiceli/vitest-cucumber";
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { parseSeedArgs } from "../adapters/inbound/cli/seed-args.js";
import type { Database } from "../adapters/outbound/postgres/database.js";
import { seedSale } from "../adapters/outbound/postgres/sale-seeder.js";
import { specFile } from "./support/paths.js";
import { recordingDb } from "./support/recording-db.js";

// A recording database, as the scenarios hold it.
type Recording = ReturnType<typeof recordingDb>;

// A fixed moment, so the window is the same in every run.
const NOW = new Date("2026-06-01T12:00:00Z");
// Whoever acts: the recording database has no users, so any id will do.
const ACTOR = "00000000-0000-4000-8000-0000000000bb";

function statementsInto(db: Recording, table: string) {
	return db.statements.filter((s) =>
		s.sql.startsWith(`insert into "${table}"`),
	);
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
	db: Recording,
	stock: number,
	startsIn: number,
	duration: number,
): Promise<void> {
	const parsed = parseSeedArgs(seedArgs(stock, startsIn, duration), NOW);
	if (parsed.isErr()) throw new Error(parsed.error);
	await seedSale(db.db as unknown as Kysely<Database>, parsed.value, ACTOR);
}

// A seed the command refuses: nothing is stored, and the message the command gives is the one the scenario names.
function refusesSeed({ Given, When, Then, And }: StepTest) {
	let db: Recording;
	let failure: unknown;

	Given("a database migrated to the latest version", () => {
		db = recordingDb();
	});

	When(
		"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
		async (_ctx, stock: number, startsIn: number, duration: number) => {
			try {
				await seedFrom(db, stock, startsIn, duration);
			} catch (error) {
				failure = error;
			}
		},
	);

	Then("seeding fails with {string}", (_ctx, message: string) => {
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(message);
	});

	And("the sales table holds {int} sales", (_ctx, count: number) => {
		expect(statementsInto(db, "sales")).toHaveLength(count);
	});
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/seeding.feature")),
	({ Scenario }) => {
		Scenario(
			"Seeding creates a sale with the given stock and window",
			({ Given, When, Then, And }) => {
				let db: Recording;

				Given("a database migrated to the latest version", () => {
					db = recordingDb();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						await seedFrom(db, stock, startsIn, duration);
					},
				);

				// Without a database, the unit proof is the one insert sent and its values.
				Then(
					"the sales table holds {int} sale with stock {int}",
					(_ctx, count: number, stock: number) => {
						const inserts = statementsInto(db, "sales");
						expect(inserts).toHaveLength(count);
						expect(inserts[0]?.parameters).toContain(stock);
					},
				);

				And("that sale is open for {int} minutes", (_ctx, minutes: number) => {
					const dates = (
						statementsInto(db, "sales")[0]?.parameters ?? []
					).filter((value): value is Date => value instanceof Date);
					expect(dates).toHaveLength(2);
					const [opens = NOW, closes = NOW] = dates;
					expect(closes.getTime() - opens.getTime()).toBe(minutes * 60_000);
				});
			},
		);

		Scenario(
			"Seeding refuses a stock that is not a positive integer",
			refusesSeed,
		);

		Scenario("Seeding refuses a window that lasts no minutes", refusesSeed);

		Scenario(
			"Seeding refuses a window that starts too far in the future",
			refusesSeed,
		);
	},
);
