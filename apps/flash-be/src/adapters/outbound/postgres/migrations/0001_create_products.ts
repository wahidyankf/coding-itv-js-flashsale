// Migration 0001: a placeholder table that proves the migration flow. Migration 0002 drops it for the real schema.
import { type Kysely, sql } from "kysely";

// Creates the placeholder `products` table. It is replaced once the real domain is known.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("products")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("deleted_at", "timestamptz")
		.execute();
}

// Drops the placeholder table again.
export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("products").execute();
}
