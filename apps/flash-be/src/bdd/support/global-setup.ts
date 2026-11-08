// The setup of one integration run, which Vitest calls once: a fresh Postgres database, migrated, and the test Redis
// index emptied. The function it returns drops the database and frees the run lock when the run ends. A second run
// started while the first is active stops at once, because its Redis flush would empty the first run's data.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import { createDb } from "../../adapters/outbound/postgres/database.js";
import { createMigrator } from "../../adapters/outbound/postgres/migrator.js";
import { localDefaults } from "../../local-defaults.js";

// Redis database index reserved for tests. FLUSHDB runs only on this index, never on dev data (index 0).
const TEST_REDIS_DB = 15;

// Postgres session lock that marks an active integration run. Postgres frees it when the holding connection closes,
// so a crashed run leaves no stale lock. Locks are per database, so two runs conflict when they share DATABASE_URL.
const RUN_LOCK_KEY = 9_183_001;

const RUN_BUSY_MESSAGE =
	"another flash-be integration run is active; run one at a time";

// Runs once per integration run. Takes the run lock, creates a fresh Postgres database for this run and migrates it,
// points the tests at it and at the test Redis index, and drops the database and frees the lock when the run ends.
export default async function setup(): Promise<() => Promise<void>> {
	const serverUrl = process.env.DATABASE_URL ?? localDefaults.databaseUrl;
	const databaseName = `flash_it_${randomUUID().replaceAll("-", "_")}`;

	// The admin connection holds the run lock, so it stays open until teardown. Closing it frees the lock.
	const admin = new pg.Client({ connectionString: serverUrl });
	await admin.connect();
	try {
		await takeRunLock(admin);
		await admin.query(`create database "${databaseName}"`);

		const databaseUrl = new URL(serverUrl);
		databaseUrl.pathname = `/${databaseName}`;

		// The run database gets the schema once. Scenarios that need no tables use their own scratch database.
		const db = createDb(databaseUrl.toString());
		const { error } = await createMigrator(db).migrateToLatest();
		await db.destroy();
		if (error) throw error;

		const redisUrl = new URL(process.env.REDIS_URL ?? localDefaults.redisUrl);
		redisUrl.pathname = `/${TEST_REDIS_DB}`;

		const redis = createClient({ url: redisUrl.toString() });
		await redis.connect();
		await redis.flushDb();
		await redis.close();

		process.env.DATABASE_URL = databaseUrl.toString();
		process.env.REDIS_URL = redisUrl.toString();
		// Sale reads are not cached here, so a scenario that changes a sale sees the change. Cache scenarios turn it on.
		process.env.SALE_CACHE_MS = "0";
	} catch (error) {
		// Nothing else holds this connection, so closing it frees the lock for the next run.
		await admin.end();
		throw error;
	}

	return async () => {
		try {
			await admin.query(
				`drop database if exists "${databaseName}" with (force)`,
			);
		} finally {
			await admin.end();
		}
	};
}

// Asks for the run lock without waiting. A run that finds it held fails here, before it creates or flushes anything.
async function takeRunLock(admin: pg.Client): Promise<void> {
	const result = await admin.query<{ locked: boolean }>(
		"select pg_try_advisory_lock($1) as locked",
		[RUN_LOCK_KEY],
	);
	if (result.rows[0]?.locked !== true) throw new Error(RUN_BUSY_MESSAGE);
}
