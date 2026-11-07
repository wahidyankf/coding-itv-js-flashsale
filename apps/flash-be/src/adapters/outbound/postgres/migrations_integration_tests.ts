// Integration test for the migrations over a scratch database on the dev Postgres: they roll back one at a time.
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

async function columns(
	db: ReturnType<typeof createDb>,
	table: string,
): Promise<string[]> {
	const result = await sql<{
		name: string;
	}>`select column_name as name from information_schema.columns where table_name = ${table}`.execute(
		db,
	);
	return result.rows.map((row) => row.name);
}

async function liveUsers(db: ReturnType<typeof createDb>): Promise<string[]> {
	const result = await sql<{
		username: string;
	}>`select username from users where deleted_at is null order by username`.execute(
		db,
	);
	return result.rows.map((row) => row.username);
}

it("rolls the migrations back one at a time", async () => {
	const { url, drop } = await createScratchDatabase();
	const db = createDb(url);
	cleanups.push(() => db.destroy(), drop);
	const migrator = createMigrator(db);

	const up = await migrator.migrateToLatest();
	expect(up.error).toBeUndefined();
	expect(await liveUsers(db)).toEqual(["$system"]);

	// Logins go: the sessions table, and the columns of an account. The stand-in operator is a live user again.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	expect(await exists(db, "sessions")).toBe(false);
	expect(await columns(db, "users")).not.toContain("role");
	expect(await columns(db, "users")).not.toContain("password_hash");
	expect(await liveUsers(db)).toEqual(["$operator", "$system"]);

	// Users, products and the audit columns go: the sales tables stay, with the user as text again.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	expect(await exists(db, "users")).toBe(false);
	expect(await columns(db, "sales")).not.toContain("product_id");
	expect(await columns(db, "purchases")).not.toContain("deleted_at");

	// The sales tables go; the first table stays.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	expect(await exists(db, "products")).toBe(true);
	for (const table of ["sales", "purchases", "reservations"]) {
		expect(await exists(db, table)).toBe(false);
	}
});
