// Migration 0004: the sessions of logins. A session holds the two tokens of one login: a short access token, and a long
// refresh token that is replaced each time it is used. Only the SHA-256 of a token is stored, so a copy of the database
// cannot be used to act as a user.
import { type Kysely, sql } from "kysely";

// Creates the sessions table and its indexes. It promises the table and nothing else. Nothing is erased: a session that
// ends is marked deleted.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("sessions")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("user_id", "uuid", (col) =>
			col.notNull().references("users.id").onDelete("restrict"),
		)
		.addColumn("access_hash", "text", (col) => col.notNull())
		.addColumn("access_expires_at", "timestamptz", (col) => col.notNull())
		.addColumn("refresh_hash", "text", (col) => col.notNull())
		.addColumn("refresh_expires_at", "timestamptz", (col) => col.notNull())
		// The refresh token before the last one. If it comes back, it was stolen or replayed, and the session ends.
		.addColumn("previous_refresh_hash", "text")
		// Where the login came from, so a user (or an operator) can recognise a session that is not theirs.
		.addColumn("ip", "text")
		.addColumn("user_agent", "text")
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("created_by", "uuid", (col) =>
			col.notNull().references("users.id"),
		)
		.addColumn("updated_at", "timestamptz")
		.addColumn("updated_by", "uuid", (col) => col.references("users.id"))
		.addColumn("deleted_at", "timestamptz")
		.addColumn("deleted_by", "uuid", (col) => col.references("users.id"))
		.execute();
	// A live token is unique, so no two live sessions share one.
	await sql`create unique index sessions_access_live on sessions (access_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create unique index sessions_refresh_live on sessions (refresh_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create index sessions_user on sessions (user_id)`.execute(db);
}

// Drops the sessions table. It promises that no session is left behind.
export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("sessions").execute();
}
