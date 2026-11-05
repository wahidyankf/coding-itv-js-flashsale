import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import { createDb } from "../../db.js";
import { createMigrator } from "../../migrator.js";

// Redis database index reserved for tests. FLUSHDB runs only on this index, never on dev data (index 0).
const TEST_REDIS_DB = 15;
const DEFAULT_DATABASE_URL = "postgres://flash:flash@localhost:5432/flash";
const DEFAULT_REDIS_URL = "redis://localhost:6379";

// Runs once per integration run. Creates a fresh Postgres database for this run and migrates it, points the
// tests at it and at the test Redis index, and drops the database when the run ends.
export default async function setup(): Promise<() => Promise<void>> {
	const serverUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
	const databaseName = `flash_it_${randomUUID().replaceAll("-", "_")}`;

	const admin = new pg.Client({ connectionString: serverUrl });
	await admin.connect();
	await admin.query(`create database "${databaseName}"`);
	await admin.end();

	const databaseUrl = new URL(serverUrl);
	databaseUrl.pathname = `/${databaseName}`;

	// The run database gets the schema once. Scenarios that need no tables use their own scratch database.
	const db = createDb(databaseUrl.toString());
	const { error } = await createMigrator(db).migrateToLatest();
	await db.destroy();
	if (error) throw error;

	const redisUrl = new URL(process.env.REDIS_URL ?? DEFAULT_REDIS_URL);
	redisUrl.pathname = `/${TEST_REDIS_DB}`;

	const redis = createClient({ url: redisUrl.toString() });
	await redis.connect();
	await redis.flushDb();
	await redis.close();

	process.env.DATABASE_URL = databaseUrl.toString();
	process.env.REDIS_URL = redisUrl.toString();
	// Sale reads are not cached here, so a scenario that changes a sale sees the change. Cache scenarios turn it on.
	process.env.SALE_CACHE_MS = "0";

	return async () => {
		const cleanup = new pg.Client({ connectionString: serverUrl });
		await cleanup.connect();
		await cleanup.query(
			`drop database if exists "${databaseName}" with (force)`,
		);
		await cleanup.end();
	};
}
