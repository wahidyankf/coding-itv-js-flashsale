import { createDb } from "./adapters/outbound/postgres/database.js";
import { createMigrator } from "./adapters/outbound/postgres/migrator.js";
import { config } from "./config.js";

const db = createDb(config.databaseUrl);

try {
	const { error, results } = await createMigrator(db).migrateToLatest();

	for (const result of results ?? []) {
		console.log(`${result.migrationName}: ${result.status}`);
	}

	if (error) {
		console.error(error);
		process.exitCode = 1;
	}
} finally {
	await db.destroy();
}
