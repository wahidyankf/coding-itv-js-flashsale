// Logins in Postgres: each session holds two tokens, and Postgres has the last word on whether one is still good. Only the
// SHA-256 hashes of the tokens are stored, so a copy of the table cannot be used to log in. Outbound Postgres adapter for
// the SessionStore port.
import { type Kysely, sql } from "kysely";
import type {
	NewSession,
	Rotation,
	SessionStore,
} from "../../../application/ports/session-store.js";
import type { Principal } from "../../../domain/auth.js";
import { storedUsername, userIdOf } from "../../../domain/user.js";
import type { Database } from "./database.js";

const now = sql<Date>`now()`;

// What a rotation hands back: the user, when the refresh token worked, and the access hashes that stopped working.
type Rotated = { principal: Principal | undefined; ended: string[] };

// The user behind a session, as the rest of the code knows them. Nothing is returned for a deleted user.
async function principalOf(
	db: Kysely<Database>,
	userId: string,
): Promise<Principal | undefined> {
	const user = await db
		.selectFrom("users")
		.select(["id", "username", "role"])
		.where("id", "=", userId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
	return user === undefined
		? undefined
		: {
				userId: userIdOf(user.id),
				username: storedUsername(user.username),
				role: user.role,
			};
}

// Records a login, and stamps the user's last login, in one transaction.
async function createSession(
	db: Kysely<Database>,
	session: NewSession,
): Promise<void> {
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
}

// The session that is still open with this access token, and its end time, if there is one.
async function findLiveSession(
	db: Kysely<Database>,
	accessHash: string,
	at: Date,
): Promise<{ principal: Principal; expiresAt: Date } | undefined> {
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
					userId: userIdOf(row.id),
					username: storedUsername(row.username),
					role: row.role,
				},
				expiresAt: row.access_expires_at,
			};
}

// The open session that holds this refresh token as its current one, locked for the rotation.
async function currentByRefresh(trx: Kysely<Database>, refreshHash: string) {
	return trx
		.selectFrom("sessions")
		.select(["id", "user_id", "access_hash", "refresh_expires_at"])
		.where("refresh_hash", "=", refreshHash)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
}

// The refresh token of the step before came back. Only a copy of it can do that, so two parties hold it, and the session
// ends. Returns the access hash that ended, so a cache can forget it.
async function endReplayedSession(
	trx: Kysely<Database>,
	refreshHash: string,
): Promise<Rotated> {
	const replayed = await trx
		.selectFrom("sessions")
		.select(["id", "user_id", "access_hash"])
		.where("previous_refresh_hash", "=", refreshHash)
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

// Puts the new pair of tokens in place of the session's current pair. The old refresh token is kept as the previous one,
// so that a replay of it can be seen.
async function swapTokens(
	trx: Kysely<Database>,
	sessionId: string,
	userId: string,
	rotation: Rotation,
): Promise<void> {
	await trx
		.updateTable("sessions")
		.set({
			access_hash: rotation.accessHash,
			access_expires_at: rotation.accessExpiresAt,
			previous_refresh_hash: rotation.presentedRefreshHash,
			refresh_hash: rotation.refreshHash,
			refresh_expires_at: rotation.refreshExpiresAt,
			updated_at: now,
			updated_by: userId,
		})
		.where("id", "=", sessionId)
		.execute();
}

// Swaps the tokens of a session when the refresh token is its current one and still in time. Otherwise it refuses, and a
// replay ends the session.
async function rotateSession(
	db: Kysely<Database>,
	rotation: Rotation,
): Promise<Rotated> {
	return db.transaction().execute(async (trx): Promise<Rotated> => {
		const current = await currentByRefresh(trx, rotation.presentedRefreshHash);
		if (current === undefined) {
			return endReplayedSession(trx, rotation.presentedRefreshHash);
		}
		// A refresh token past its end is refused, and the session is left as it is.
		if (current.refresh_expires_at <= rotation.now) {
			return { principal: undefined, ended: [] };
		}
		await swapTokens(trx, current.id, current.user_id, rotation);
		return {
			principal: await principalOf(trx, current.user_id),
			ended: [current.access_hash],
		};
	});
}

// Ends the sessions that these tokens belong to. The access hashes they had are returned, so a cache can forget them.
async function revokeSessions(
	db: Kysely<Database>,
	hashes: { accessHash?: string | undefined; refreshHash?: string | undefined },
): Promise<string[]> {
	const { accessHash, refreshHash } = hashes;
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
}

// The session store over Postgres. The methods are the steps above; the factory only connects them.
export function createSessionStore(db: Kysely<Database>): SessionStore {
	return {
		create: (session) => createSession(db, session),
		findByAccess: (accessHash, at) => findLiveSession(db, accessHash, at),
		rotate: (rotation) => rotateSession(db, rotation),
		revoke: (hashes) => revokeSessions(db, hashes),
	};
}
