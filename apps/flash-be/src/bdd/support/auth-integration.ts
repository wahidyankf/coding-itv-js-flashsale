// The auth steps' integration layer: two apps over the run's Postgres and Redis, each with its own connections, as two
// servers behind a load balancer, with real password hashing and the Redis cache of logins. An access token ends by its row and its cache entry, as the 15 minutes would end it.
import { MS_PER_HOUR } from "@flash/flash-commons";
import { type Kysely, sql } from "kysely";
import { buildApp } from "../../adapters/inbound/http/app.js";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import { createRedis } from "../../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../../composition.js";
import { config } from "../../config.js";
import { hashToken } from "../../domain/auth.js";
import { authWorld, type UserRow } from "./auth-world.js";
import { insertSale } from "./seed.js";

// Opens the run's connections and the app the auth scenarios use. `newWorld()` makes one scenario over them, and `close`
// ends the connections when the run ends.
export async function openAuthIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const instance = (
		instanceDb: Kysely<Database>,
		instanceRedis: typeof redis,
	) =>
		buildApp(
			dependenciesFrom(instanceDb, instanceRedis, {
				...config,
				saleCacheMs: 0,
				// The limit is high so the scenarios, which sign up from one address, never hit it. The limit has its own scenarios.
				authRateLimitPerIp: 100_000,
			}),
			{ cookieSecure: false },
		);
	const app = instance(db, redis);
	// The second instance opens its own connections to the same database and Redis index, and keeps nothing in memory.
	const secondDb = createDb(config.databaseUrl);
	const secondRedis = await createRedis(config.redisUrl);
	const second = instance(secondDb, secondRedis);
	return {
		db,
		newWorld: () =>
			authWorld({
				app: () => app,
				// The 15 minutes pass for the row and for the cache. The cache would otherwise answer for up to a minute.
				expireAccess: async (accessToken) => {
					const hash = hashToken(accessToken);
					await sql`update sessions set access_expires_at = now() - interval '1 minute' where access_hash = ${hash}`.execute(
						db,
					);
					await redis.del(`session:${hash}`);
				},
				expireRefresh: async (refreshToken) => {
					const hash = hashToken(refreshToken);
					await sql`update sessions set refresh_expires_at = now() - interval '1 minute' where refresh_hash = ${hash}`.execute(
						db,
					);
				},
				liveSession: async (accessToken) => {
					const rows = await db
						.selectFrom("sessions")
						.select("id")
						.where("access_hash", "=", hashToken(accessToken))
						.where("deleted_at", "is", null)
						.execute();
					return rows.length > 0;
				},
				stored: () => storedHashes(db),
				userRow: (username) => userRowOf(db, username),
				secondApp: () => second,
				openSale: () =>
					insertSale(db, {
						startsAt: new Date(Date.now() - MS_PER_HOUR),
						endsAt: new Date(Date.now() + MS_PER_HOUR),
					}),
			}),
		async close() {
			await app.close();
			await second.close();
			await redis.close();
			await secondRedis.close();
			await db.destroy();
			await secondDb.destroy();
		},
	};
}

// The password hashes of the users and the token hashes of the sessions, as the database holds them.
async function storedHashes(db: Kysely<Database>) {
	const users = await db
		.selectFrom("users")
		.select("password_hash")
		.where("password_hash", "is not", null)
		.execute();
	const sessions = await db
		.selectFrom("sessions")
		.select(["access_hash", "refresh_hash"])
		.execute();
	return {
		passwordHashes: users.flatMap((row) =>
			row.password_hash === null ? [] : [row.password_hash],
		),
		tokenHashes: sessions.flatMap((row) => [row.access_hash, row.refresh_hash]),
	};
}

// The audit fields of the live user with this name, as the database holds them.
async function userRowOf(
	db: Kysely<Database>,
	username: string,
): Promise<UserRow | undefined> {
	const row = await db
		.selectFrom("users")
		.select(["id", "last_login_at", "updated_at", "updated_by"])
		.where("username", "=", username)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
	return (
		row && {
			id: row.id,
			lastLoginAt: row.last_login_at ?? undefined,
			updatedAt: row.updated_at ?? undefined,
			updatedBy: row.updated_by ?? undefined,
		}
	);
}
