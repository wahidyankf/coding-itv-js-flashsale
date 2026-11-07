import { type Kysely, sql } from "kysely";

const OPERATOR_USERNAME = "$operator";
const SYSTEM_USERNAME = "$system";

// Accounts and sessions. A user may log in with a password and has a role. A login is one session row that holds two
// tokens: a short access token, and a long refresh token that is replaced each time it is used. Only the SHA-256 of a
// token is stored, so a copy of the database cannot be used to act as a user.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.alterTable("users")
		.addColumn("password_hash", "text")
		.execute();
	await db.schema
		.alterTable("users")
		.addColumn("role", "text", (col) => col.notNull().defaultTo("shopper"))
		.execute();
	// When the user last logged in, for the operator who wonders whether an account is still used.
	await db.schema
		.alterTable("users")
		.addColumn("last_login_at", "timestamptz")
		.execute();
	await sql`alter table users add constraint users_role_known check (role in ('shopper', 'operator'))`.execute(
		db,
	);

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
	await sql`create unique index sessions_access_live on sessions (access_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create unique index sessions_refresh_live on sessions (refresh_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create index sessions_user on sessions (user_id)`.execute(db);

	// The operator is now a real account with a login, so the stand-in the first migration made is retired. A user is
	// never erased: it is marked deleted by the system.
	await sql`update users set deleted_at = now(), deleted_by = (select id from users where username = ${SYSTEM_USERNAME})
		where username = ${OPERATOR_USERNAME}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`update users set deleted_at = null, deleted_by = null where username = ${OPERATOR_USERNAME}`.execute(
		db,
	);
	await db.schema.dropTable("sessions").execute();
	await sql`alter table users drop constraint users_role_known`.execute(db);
	await db.schema.alterTable("users").dropColumn("last_login_at").execute();
	await db.schema.alterTable("users").dropColumn("role").execute();
	await db.schema.alterTable("users").dropColumn("password_hash").execute();
}
