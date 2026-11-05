import { promises as fs } from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import type { Database } from "./database.js";

// Migrations are hand-written files in ./migrations. They load from src/ in dev and from dist/ after build.
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
