// Entry point (the outermost layer): applies the database migrations, in order, and prints each one's status. The
// migrations are the only way the schema changes.
import { createMigrator } from "./adapters/outbound/postgres/migrator.js";
import { config } from "./config.js";
import { withDb } from "./with-db.js";

// Returns the error of the migration that failed, or nothing when every migration is applied.
const failure = await withDb(config.databaseUrl, async (db) => {
	const { error, results } = await createMigrator(db).migrateToLatest();
	for (const result of results ?? []) {
		console.log(`${result.migrationName}: ${result.status}`);
	}
	return error;
});

if (failure) {
	console.error(failure);
	process.exitCode = 1;
}
