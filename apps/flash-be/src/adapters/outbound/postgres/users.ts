// The user rows that other writes point at: finding or making a user by name, and finding the system or the operator
// stand-in. Outbound Postgres adapter; a user is never erased (see decision 011).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "./database.js";

// The id of the live user with this name. A user who is logged in has a row from the sign-up, so this is one read. The
// insert is a fallback for a name that has no row yet (a hold written for a name that never signed up, as the rebuild
// and some tests do); that row has no password, so it cannot log in. A race between two first requests is settled by the
// unique index on live names.
export async function ensureUser(
	db: Kysely<Database>,
	username: string,
): Promise<string> {
	const find = () =>
		db
			.selectFrom("users")
			.select("id")
			.where("username", "=", username)
			.where("deleted_at", "is", null)
			.executeTakeFirst();
	const known = await find();
	if (known !== undefined) return known.id;
	const id = randomUUID();
	// Two first requests for one name meet in the unique index on live names; both get the id of the row that won.
	const created = await db
		.insertInto("users")
		.values({ id, username, created_by: id })
		.onConflict((conflict) =>
			conflict
				.column("username")
				.where("deleted_at", "is", null)
				.doUpdateSet({ username }),
		)
		.returning("id")
		.executeTakeFirstOrThrow();
	return created.id;
}

// The id of a user the migration made, found by name: the system or the operator. The lookup throws when the migration
// has not run, because the commands cannot work without these rows.
export async function actorId(
	db: Kysely<Database>,
	username: string,
): Promise<string> {
	const row = await db
		.selectFrom("users")
		.select("id")
		.where("username", "=", username)
		.where("deleted_at", "is", null)
		.executeTakeFirstOrThrow();
	return row.id;
}
