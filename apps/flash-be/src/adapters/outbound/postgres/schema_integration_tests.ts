import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../../config.js";
import { createDb, type Database } from "./database.js";

// The tables of the real, migrated database against the `Database` type the queries are written with. A column that
// the migrations make and the type does not know, or the other way round, fails here instead of in production.
const db = createDb(config.databaseUrl);

afterAll(async () => {
	await db.destroy();
});

// Every column of every table, as the type says. A missing or an extra key does not compile.
const COLUMNS: {
	[Table in keyof Database]: Record<keyof Database[Table], true>;
} = {
	users: {
		id: true,
		username: true,
		password_hash: true,
		role: true,
		last_login_at: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
	sessions: {
		id: true,
		user_id: true,
		access_hash: true,
		access_expires_at: true,
		refresh_hash: true,
		refresh_expires_at: true,
		previous_refresh_hash: true,
		ip: true,
		user_agent: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
	products: {
		id: true,
		name: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
	sales: {
		id: true,
		product_id: true,
		name: true,
		starts_at: true,
		ends_at: true,
		stock: true,
		sold: true,
		reservation_ttl_seconds: true,
		admit_per_second: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
	purchases: {
		id: true,
		sale_id: true,
		user_id: true,
		reservation_id: true,
		payment_ref: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
	reservations: {
		id: true,
		sale_id: true,
		user_id: true,
		expires_at: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true,
		deleted_at: true,
		deleted_by: true,
	},
};

const AUDIT = [
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
	"deleted_at",
	"deleted_by",
];

async function columnsByTable(): Promise<Map<string, string[]>> {
	const result = await sql<{
		table_name: string;
		column_name: string;
	}>`select table_name, column_name from information_schema.columns
		where table_schema = 'public' and table_name not like 'kysely\_%'
		order by table_name, ordinal_position`.execute(db);
	const tables = new Map<string, string[]>();
	for (const row of result.rows) {
		tables.set(row.table_name, [
			...(tables.get(row.table_name) ?? []),
			row.column_name,
		]);
	}
	return tables;
}

describe("the schema of the migrated database", () => {
	it("has the tables of the Database type and no other", async () => {
		const tables = await columnsByTable();
		expect([...tables.keys()].sort()).toEqual(Object.keys(COLUMNS).sort());
	});

	it("has the columns of the Database type in every table", async () => {
		const tables = await columnsByTable();
		for (const [table, columns] of Object.entries(COLUMNS)) {
			expect((tables.get(table) ?? []).sort(), table).toEqual(
				Object.keys(columns).sort(),
			);
		}
	});

	it("records who created, changed and deleted a row in every table", async () => {
		for (const [table, columns] of await columnsByTable()) {
			for (const column of AUDIT) {
				expect(columns, `${table}.${column}`).toContain(column);
			}
		}
	});
});
