import { type Generated, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export type Database = {
	products: {
		id: Generated<string>;
		name: string;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
		deleted_at: Date | null;
	};
};

export function createDb(connectionString: string): Kysely<Database> {
	return new Kysely<Database>({
		dialect: new PostgresDialect({
			pool: new pg.Pool({ connectionString }),
		}),
	});
}
