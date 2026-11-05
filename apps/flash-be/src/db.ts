import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export type Database = {
	products: {
		id: string;
		name: string;
		created_at: Date;
		updated_at: Date;
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
