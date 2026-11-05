import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { createScratchDatabase } from "../../../bdd/support/scratch-db.js";
import { createDb } from "./database.js";
import { createMigrator } from "./migrator.js";

// Only a developer rolls a migration back: the shipped process migrates upward and has no entry point for a rollback.
// So this is a plain test and not a scenario.
const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function exists(
	db: ReturnType<typeof createDb>,
	table: string,
): Promise<boolean> {
	const result = await sql<{
		name: string | null;
	}>`select to_regclass(${`public.${table}`}) as name`.execute(db);
	return result.rows[0]?.name === table;
}

it("rolls the latest migration back to the products table", async () => {
	const { url, drop } = await createScratchDatabase();
	const db = createDb(url);
	cleanups.push(() => db.destroy(), drop);
	const migrator = createMigrator(db);

	const up = await migrator.migrateToLatest();
	expect(up.error).toBeUndefined();
	const down = await migrator.migrateDown();
	expect(down.error).toBeUndefined();

	expect(await exists(db, "products")).toBe(true);
	for (const table of ["sales", "purchases", "reservations"]) {
		expect(await exists(db, table)).toBe(false);
	}
});
