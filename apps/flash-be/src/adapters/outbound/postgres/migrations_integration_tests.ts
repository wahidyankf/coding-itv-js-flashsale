// Integration test for the migrations over a scratch database on the dev Postgres: they roll back one at a time, and they
// build the constraints and indexes that the code refers to by name.
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

// An empty scratch database for one test. It is dropped when the suite ends.
async function scratchDb(): Promise<ReturnType<typeof createDb>> {
	const { url, drop } = await createScratchDatabase();
	const db = createDb(url);
	cleanups.push(() => db.destroy(), drop);
	return db;
}

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

// The definition of each constraint and index of the public schema, by name. An index of the same name as a constraint
// is read last, so its definition is the one kept.
async function definitions(
	db: ReturnType<typeof createDb>,
): Promise<Map<string, string>> {
	const result = await sql<{
		name: string;
		definition: string;
	}>`select conname as name, pg_get_constraintdef(oid) as definition
		from pg_constraint where connamespace = 'public'::regnamespace
		union all
		select indexname as name, indexdef as definition
		from pg_indexes where schemaname = 'public'`.execute(db);
	return new Map(result.rows.map((row) => [row.name, row.definition]));
}

it("rolls the migrations back one at a time", async () => {
	const db = await scratchDb();
	const migrator = createMigrator(db);

	const up = await migrator.migrateToLatest();
	expect(up.error).toBeUndefined();
	expect(await liveUsers(db)).toEqual(["$system"]);

	// Logins go: the sessions table. The accounts stay, with their login columns.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	expect(await exists(db, "sessions")).toBe(false);
	expect(await columns(db, "users")).toContain("role");
	expect(await columns(db, "users")).toContain("password_hash");

	// The purchases and the holds go; the sales stay.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	for (const table of ["purchases", "reservations"]) {
		expect(await exists(db, table)).toBe(false);
	}
	expect(await exists(db, "sales")).toBe(true);

	// The sales and their products go; the users stay.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	for (const table of ["sales", "products"]) {
		expect(await exists(db, table)).toBe(false);
	}
	expect(await liveUsers(db)).toEqual(["$system"]);

	// The users go last.
	expect((await migrator.migrateDown()).error).toBeUndefined();
	expect(await exists(db, "users")).toBe(false);
});

it("builds the constraints and indexes that the code names", async () => {
	const db = await scratchDb();
	const { error } = await createMigrator(db).migrateToLatest();
	expect(error).toBeUndefined();

	const named = await definitions(db);
	// Each sale, and each user, is refused when it breaks a rule of the sale or of the role.
	expect(named.get("sales_stock_not_negative")).toContain(
		"CHECK ((stock >= 0))",
	);
	expect(named.get("sales_sold_within_stock")).toContain(
		"CHECK ((sold <= stock))",
	);
	expect(named.get("sales_window_is_ordered")).toContain(
		"CHECK ((ends_at > starts_at))",
	);
	expect(named.get("users_role_known")).toContain(
		"CHECK ((role = ANY (ARRAY['shopper'::text, 'operator'::text])))",
	);
	// A purchase is paid for once, ever: the reservation id is plainly unique, never partial.
	expect(named.get("purchases_reservation_id_key")).toContain(
		"UNIQUE INDEX purchases_reservation_id_key ON public.purchases USING btree (reservation_id)",
	);
	// A row that is deleted no longer counts for the one-per-user and the live-name rules.
	for (const index of [
		"purchases_one_per_user",
		"reservations_one_per_user",
		"users_username_live",
		"sessions_access_live",
		"sessions_refresh_live",
	]) {
		expect(named.get(index), index).toContain("WHERE (deleted_at IS NULL)");
	}
	expect(named.get("sessions_user")).not.toContain("WHERE");
	// A product, a sale and a user that is still in use are never removed under a row.
	for (const constraint of [
		"sales_product_id_fkey",
		"purchases_sale_id_fkey",
		"reservations_sale_id_fkey",
		"sessions_user_id_fkey",
	]) {
		expect(named.get(constraint), constraint).toContain("ON DELETE RESTRICT");
	}
	expect(named.get("purchases_user_id_fkey")).not.toContain("ON DELETE");
});
