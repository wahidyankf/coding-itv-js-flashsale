import { type Generated, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export type Database = {
	sales: {
		id: Generated<string>;
		name: string;
		starts_at: Date;
		ends_at: Date;
		stock: number;
		sold: Generated<number>;
		reservation_ttl_seconds: Generated<number>;
		admit_per_second: Generated<number>;
		created_at: Generated<Date>;
	};
	purchases: {
		id: Generated<string>;
		sale_id: string;
		user_id: string;
		reservation_id: string;
		payment_ref: string;
		created_at: Generated<Date>;
	};
	reservations: {
		id: Generated<string>;
		sale_id: string;
		user_id: string;
		expires_at: Date;
		created_at: Generated<Date>;
	};
};

export function createDb(connectionString: string): Kysely<Database> {
	return new Kysely<Database>({
		dialect: new PostgresDialect({
			pool: new pg.Pool({ connectionString }),
		}),
	});
}
