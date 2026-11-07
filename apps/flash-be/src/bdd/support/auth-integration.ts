// The auth steps' integration layer: the app over the run's Postgres and Redis, with real password hashing and the Redis
// cache of logins. An access token ends by its row and its cache entry, as the 15 minutes would end it.
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
import { authWorld } from "./auth-world.js";

// Opens the run's connections and the app the auth scenarios use. `newWorld()` makes one scenario over them, and `close`
// ends the connections when the run ends.
export async function openAuthIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const app = buildApp(
		dependenciesFrom(db, redis, {
			...config,
			saleCacheMs: 0,
			// Every scenario signs up from the same address, and the limit has its own scenarios.
			authRateLimitPerIp: 100_000,
		}),
		{ cookieSecure: false },
	);
	return {
		db,
		newWorld: () =>
			authWorld({
				app: () => app,
				// The 15 minutes pass: the row says so, and so must the cache, which would otherwise answer for up to a minute.
				expireAccess: async (accessToken) => {
					const hash = hashToken(accessToken);
					await sql`update sessions set access_expires_at = now() - interval '1 minute' where access_hash = ${hash}`.execute(
						db,
					);
					await redis.del(`session:${hash}`);
				},
				stored: () => storedHashes(db),
			}),
		async close() {
			await app.close();
			await redis.close();
			await db.destroy();
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
