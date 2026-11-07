// The migrator: it applies the hand-written migrations in ./migrations, in order. Outbound Postgres adapter, used by the
// migrate entry point and by the integration setup. Migrations load from src/ in dev and from dist/ after the build.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import type { Database } from "./database.js";

// The migrator for this database. The migrations are the only way the schema changes.
export function createMigrator(db: Kysely<Database>): Migrator {
	return new Migrator({
		db,
		provider: new FileMigrationProvider({
			fs,
			path,
			migrationFolder: path.join(import.meta.dirname, "migrations"),
		}),
	});
}
