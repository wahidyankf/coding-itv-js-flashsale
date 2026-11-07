import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { parseSeedArgs } from "../adapters/inbound/cli/seed-args.js";
import type { Database } from "../adapters/outbound/postgres/database.js";
import { seedSale } from "../adapters/outbound/postgres/sale-seeder.js";
import { specFile } from "./support/paths.js";
import { recordingDb } from "./support/recording-db.js";

// A fixed moment, so the window is the same in every run.
const NOW = new Date("2026-06-01T12:00:00Z");
// Whoever acts: the recording database has no users, so any id will do.
const ACTOR = "00000000-0000-4000-8000-0000000000bb";

function statementsInto(
	db: ReturnType<typeof recordingDb>,
	table: string,
): ReturnType<typeof recordingDb>["statements"] {
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

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/seeding.feature")),
	({ Scenario }) => {
		Scenario(
			"Seeding creates a sale with the given stock and window",
			({ Given, When, Then, And }) => {
				let db: ReturnType<typeof recordingDb>;

				Given("a database migrated to the latest version", () => {
					db = recordingDb();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						const input = parseSeedArgs(
							seedArgs(stock, startsIn, duration),
							NOW,
						);
						await seedSale(db.db as unknown as Kysely<Database>, input, ACTOR);
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
			({ Given, When, Then, And }) => {
				let db: ReturnType<typeof recordingDb>;
				let failure: unknown;

				Given("a database migrated to the latest version", () => {
					db = recordingDb();
				});

				When(
					"the sale is seeded with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, duration: number) => {
						try {
							const input = parseSeedArgs(
								seedArgs(stock, startsIn, duration),
								NOW,
							);
							await seedSale(
								db.db as unknown as Kysely<Database>,
								input,
								ACTOR,
							);
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
			},
		);
	},
);
