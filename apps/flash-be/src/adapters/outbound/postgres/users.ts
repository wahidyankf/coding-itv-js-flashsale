// The user rows that other writes point at: finding or making a user by name, finding the system or the operator stand-in,
// and reading a user as a principal. Outbound Postgres adapter; a user is never erased (see decision 011).
import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Principal } from "../../../domain/auth.js";
import { storedUsername, type UserId, userIdOf } from "../../../domain/user.js";
import type { Database } from "./database.js";
import { live } from "./queries.js";

// The live user with this name. Every read of a user by name starts here, so the live check is written once.
export function liveUserByName(db: Kysely<Database>, username: string) {
	return db
		.selectFrom("users")
		.where("username", "=", username)
		.where(live("users"));
}

// The user as the rest of the code knows them: the id, the name and the role, and nothing else.
export function toPrincipal(
	row: Pick<Selectable<Database["users"]>, "id" | "username" | "role">,
): Principal {
	return {
		userId: userIdOf(row.id),
		username: storedUsername(row.username),
		role: row.role,
	};
}

// The id of the live user with this name. A user who is logged in has a row from the sign-up, so this is one read. The
// insert is a fallback for a name that has no row yet (a hold written for a name that never signed up, as the rebuild
// and some tests do); that row has no password, so it cannot log in. A race between two first requests is settled by the
// unique index on live names.
export async function ensureUser(
	db: Kysely<Database>,
	username: string,
): Promise<string> {
	const known = await liveUserByName(db, username)
		.select("id")
		.executeTakeFirst();
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
): Promise<UserId> {
	const row = await liveUserByName(db, username)
		.select("id")
		.executeTakeFirstOrThrow();
	return userIdOf(row.id);
}
