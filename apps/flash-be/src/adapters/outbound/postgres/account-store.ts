// The accounts that can log in, kept in Postgres. Outbound Postgres adapter for the AccountStore port. The system user has
// no password, so it is not an account and cannot log in.
import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import type { Kysely } from "kysely";
import type { AccountStore } from "../../../application/ports/account-store.js";
import type { Database } from "./database.js";

// The accounts of the app over Postgres. A name is taken once by a live account; the unique index decides a race.
export function createAccountStore(db: Kysely<Database>): AccountStore {
	return {
		async register(account) {
			// The id is made here, so the author of a new account can be the account itself.
			const id = randomUUID();
			const row = await db
				.insertInto("users")
				.values({
					id,
					username: account.username,
					password_hash: account.passwordHash,
					role: account.role,
					created_by: account.createdBy ?? id,
				})
				// A user made before accounts existed has a name and no password; its name stays taken.
				.onConflict((conflict) =>
					conflict
						.column("username")
						.where("deleted_at", "is", null)
						.doNothing(),
				)
				.returning("id")
				.executeTakeFirst();
			return row === undefined
				? new Err("username_taken" as const)
				: new Ok({
						userId: row.id,
						username: account.username,
						role: account.role,
					});
		},

		async findCredentials(username) {
			const row = await db
				.selectFrom("users")
				.select(["id", "username", "role", "password_hash"])
				.where("username", "=", username)
				.where("deleted_at", "is", null)
				.executeTakeFirst();
			if (row === undefined || row.password_hash === null) return undefined;
			return {
				principal: { userId: row.id, username: row.username, role: row.role },
				passwordHash: row.password_hash,
			};
		},
	};
}
