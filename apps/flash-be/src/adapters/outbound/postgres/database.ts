import { type Generated, Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Role } from "../../../domain/auth.js";

// Who made a row, who changed it and who deleted it. A row is never erased: a deletion fills `deleted_at` and
// `deleted_by`. A change or a deletion is empty until it happens.
type Audit = {
	created_at: Generated<Date>;
	created_by: string;
	updated_at: Date | null;
	updated_by: string | null;
	deleted_at: Date | null;
	deleted_by: string | null;
};

export type Database = {
	users: Audit & {
		id: Generated<string>;
		username: string;
		// Empty for a user that cannot log in, such as the system.
		password_hash: string | null;
		role: Generated<Role>;
		last_login_at: Date | null;
	};
	sessions: Audit & {
		id: Generated<string>;
		user_id: string;
		access_hash: string;
		access_expires_at: Date;
		refresh_hash: string;
		refresh_expires_at: Date;
		previous_refresh_hash: string | null;
		ip: string | null;
		user_agent: string | null;
	};
	products: Audit & {
		id: Generated<string>;
		name: string;
	};
	sales: Audit & {
		id: Generated<string>;
		product_id: string;
		name: string;
		starts_at: Date;
		ends_at: Date;
		stock: number;
		sold: Generated<number>;
		reservation_ttl_seconds: Generated<number>;
		admit_per_second: Generated<number>;
	};
	purchases: Audit & {
		id: Generated<string>;
		sale_id: string;
		user_id: string;
		reservation_id: string;
		payment_ref: string;
	};
	reservations: Audit & {
		id: Generated<string>;
		sale_id: string;
		user_id: string;
		expires_at: Date;
	};
};

export function createDb(connectionString: string): Kysely<Database> {
	return new Kysely<Database>({
		dialect: new PostgresDialect({
			pool: new pg.Pool({ connectionString }),
		}),
	});
}
