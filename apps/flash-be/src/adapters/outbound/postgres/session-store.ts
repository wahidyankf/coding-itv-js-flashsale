import { type Kysely, sql } from "kysely";
import type { SessionStore } from "../../../application/ports/session-store.js";
import type { Principal } from "../../../domain/auth.js";
import type { Database } from "./database.js";

const now = sql<Date>`now()`;

export function createSessionStore(db: Kysely<Database>): SessionStore {
	// The user behind a session, as the rest of the code knows them.
	const principalOf = async (
		trx: Kysely<Database>,
		userId: string,
	): Promise<Principal | undefined> => {
		const user = await trx
			.selectFrom("users")
			.select(["id", "username", "role"])
			.where("id", "=", userId)
			.where("deleted_at", "is", null)
			.executeTakeFirst();
		return user === undefined
			? undefined
			: { userId: user.id, username: user.username, role: user.role };
	};

	return {
		async create(session) {
			await db.transaction().execute(async (trx) => {
				await trx
					.insertInto("sessions")
					.values({
						user_id: session.userId,
						access_hash: session.accessHash,
						access_expires_at: session.accessExpiresAt,
						refresh_hash: session.refreshHash,
						refresh_expires_at: session.refreshExpiresAt,
						ip: session.ip ?? null,
						user_agent: session.userAgent ?? null,
						created_by: session.userId,
					})
					.execute();
				await trx
					.updateTable("users")
					.set({ last_login_at: now })
					.where("id", "=", session.userId)
					.execute();
			});
		},

		async findByAccess(accessHash, at) {
			const row = await db
				.selectFrom("sessions")
				.innerJoin("users", "users.id", "sessions.user_id")
				.select([
					"users.id",
					"users.username",
					"users.role",
					"sessions.access_expires_at",
				])
				.where("sessions.access_hash", "=", accessHash)
				.where("sessions.deleted_at", "is", null)
				.where("sessions.access_expires_at", ">", at)
				.where("users.deleted_at", "is", null)
				.executeTakeFirst();
			return row === undefined
				? undefined
				: {
						principal: {
							userId: row.id,
							username: row.username,
							role: row.role,
						},
						expiresAt: row.access_expires_at,
					};
		},

		async rotate(rotation) {
			return db.transaction().execute(async (trx) => {
				const current = await trx
					.selectFrom("sessions")
					.select(["id", "user_id", "access_hash", "refresh_expires_at"])
					.where("refresh_hash", "=", rotation.presentedRefreshHash)
					.where("deleted_at", "is", null)
					.forUpdate()
					.executeTakeFirst();
				if (current === undefined) {
					// The token of the step before is dead. Using it again means two parties hold it, so the session ends.
					const replayed = await trx
						.selectFrom("sessions")
						.select(["id", "user_id", "access_hash"])
						.where("previous_refresh_hash", "=", rotation.presentedRefreshHash)
						.where("deleted_at", "is", null)
						.forUpdate()
						.executeTakeFirst();
					if (replayed !== undefined) {
						await trx
							.updateTable("sessions")
							.set({ deleted_at: now, deleted_by: replayed.user_id })
							.where("id", "=", replayed.id)
							.execute();
					}
					return {
						principal: undefined,
						ended: replayed ? [replayed.access_hash] : [],
					};
				}
				if (current.refresh_expires_at <= rotation.now) {
					return { principal: undefined, ended: [] };
				}
				await trx
					.updateTable("sessions")
					.set({
						access_hash: rotation.accessHash,
						access_expires_at: rotation.accessExpiresAt,
						previous_refresh_hash: rotation.presentedRefreshHash,
						refresh_hash: rotation.refreshHash,
						refresh_expires_at: rotation.refreshExpiresAt,
						updated_at: now,
						updated_by: current.user_id,
					})
					.where("id", "=", current.id)
					.execute();
				return {
					principal: await principalOf(trx, current.user_id),
					ended: [current.access_hash],
				};
			});
		},

		async revoke({ accessHash, refreshHash }) {
			if (accessHash === undefined && refreshHash === undefined) return [];
			const ended = await db
				.updateTable("sessions")
				.set((eb) => ({ deleted_at: now, deleted_by: eb.ref("user_id") }))
				.where("deleted_at", "is", null)
				.where((eb) =>
					eb.or([
						...(accessHash === undefined
							? []
							: [eb("access_hash", "=", accessHash)]),
						...(refreshHash === undefined
							? []
							: [
									eb("refresh_hash", "=", refreshHash),
									eb("previous_refresh_hash", "=", refreshHash),
								]),
					]),
				)
				.returning("access_hash")
				.execute();
			return ended.map((row) => row.access_hash);
		},
	};
}
