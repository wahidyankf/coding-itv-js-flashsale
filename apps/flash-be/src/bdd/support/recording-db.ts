// A Kysely instance that records SQL and never connects. A unit test uses it to check what a migration or a seed would
// send to Postgres.
import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";

// One statement a recording database was sent: its SQL and the values it was given, for the migration and seed checks.
export type Statement = { sql: string; parameters: readonly unknown[] };

// A Kysely instance that never opens a connection. It records each SQL statement and its parameters, so a
// unit test can prove what a migration or a seed would send to Postgres without a database.
export function recordingDb(): {
	db: Kysely<unknown>;
	queries: string[];
	statements: Statement[];
} {
	const queries: string[] = [];
	const statements: Statement[] = [];
	const db = new Kysely<unknown>({
		dialect: {
			createAdapter: () => new PostgresAdapter(),
			createDriver: () => new DummyDriver(),
			createIntrospector: (database) => new PostgresIntrospector(database),
			createQueryCompiler: () => new PostgresQueryCompiler(),
		},
		log: (event) => {
			if (event.level !== "query") return;
			queries.push(event.query.sql);
			statements.push({
				sql: event.query.sql,
				parameters: event.query.parameters,
			});
		},
	});
	return { db, queries, statements };
}
