import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";

// A Kysely instance that never opens a connection. It records each SQL statement, so a unit
// test can prove what a migration would send to Postgres without a database.
export function recordingDb(): { db: Kysely<unknown>; queries: string[] } {
	const queries: string[] = [];
	const db = new Kysely<unknown>({
		dialect: {
			createAdapter: () => new PostgresAdapter(),
			createDriver: () => new DummyDriver(),
			createIntrospector: (database) => new PostgresIntrospector(database),
			createQueryCompiler: () => new PostgresQueryCompiler(),
		},
		log: (event) => {
			if (event.level === "query") queries.push(event.query.sql);
		},
	});
	return { db, queries };
}
