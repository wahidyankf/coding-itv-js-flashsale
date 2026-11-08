// Integration test for the migration over a scratch database on the dev Postgres: it rolls back in one step, and it builds
// the constraints and indexes that the code refers to by name.
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

it("rolls the schema back in one step, and leaves no table behind", async () => {
	const db = await scratchDb();
	const migrator = createMigrator(db);

	const up = await migrator.migrateToLatest();
	expect(up.error).toBeUndefined();
	expect(await liveUsers(db)).toEqual(["$system"]);

	expect((await migrator.migrateDown()).error).toBeUndefined();
	for (const table of [
		"payments",
		"sessions",
		"reservations",
		"purchases",
		"sales",
		"products",
		"users",
	]) {
		expect(await exists(db, table), table).toBe(false);
	}
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
	// The lookups that grow with the rows: the replay check and the logout by the previous refresh token, and the holds of a
	// sale that still count, read by the Postgres fallback and the rebuild.
	expect(named.get("sessions_previous_refresh_live")).toContain(
		"INDEX sessions_previous_refresh_live ON public.sessions USING btree (previous_refresh_hash) WHERE (deleted_at IS NULL)",
	);
	expect(named.get("reservations_live_by_expiry")).toContain(
		"INDEX reservations_live_by_expiry ON public.reservations USING btree (sale_id, expires_at) WHERE (deleted_at IS NULL)",
	);
	// The payment ledger: one row per reservation for good, a ref of its own for each charge, and a charge always has one.
	expect(named.get("payments_reservation_id_key")).toContain(
		"UNIQUE INDEX payments_reservation_id_key ON public.payments USING btree (reservation_id)",
	);
	expect(named.get("payments_ref_key")).toContain(
		"UNIQUE INDEX payments_ref_key ON public.payments USING btree (ref)",
	);
	expect(named.get("payments_status_known")).toContain(
		"CHECK ((status = ANY (ARRAY['charged'::text, 'declined'::text, 'refunded'::text])))",
	);
	expect(named.get("payments_charged_has_ref")).toContain(
		"CHECK (((status <> 'charged'::text) OR (ref IS NOT NULL)))",
	);
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
