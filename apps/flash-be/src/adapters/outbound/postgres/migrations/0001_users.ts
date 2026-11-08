// Migration 0001: the users table, with the login columns of an account, the six audit columns, and the system user that
// acts when no person does. Every other table refers to a user, so this comes first.
import { type Kysely, sql } from "kysely";

// The system user's name. The migration keeps its own copy, so it never reads live code. The name starts with `$`, which
// a shopper's user id cannot contain, so no shopper can take it. `domain/actors.ts` repeats the name; a test keeps them equal.
const SYSTEM_USERNAME = "$system";

// Creates the users table, the index that keeps live names unique, and the system user. It promises a users table with
// the system user in it, and nothing else.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("users")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("username", "text", (col) => col.notNull())
		// Empty for a user that cannot log in, such as the system.
		.addColumn("password_hash", "text")
		.addColumn("role", "text", (col) => col.notNull().defaultTo("shopper"))
		// When the user last logged in, for the operator who wonders whether an account is still used.
		.addColumn("last_login_at", "timestamptz")
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
		.addCheckConstraint(
			"users_role_known",
			sql`role in ('shopper', 'operator')`,
		)
		.execute();

	// A name is free again once its user is deleted.
	await sql`create unique index users_username_live on users (username) where deleted_at is null`.execute(
		db,
	);

	// The system is its own author: no user exists before it, so it names itself.
	await sql`insert into users (id, username, created_by)
		select id, ${SYSTEM_USERNAME}, id from (select gen_random_uuid() as id) as fresh`.execute(
		db,
	);
}

// Drops the users table, and the system user with it. It promises that no users table is left behind.
export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("users").execute();
}
