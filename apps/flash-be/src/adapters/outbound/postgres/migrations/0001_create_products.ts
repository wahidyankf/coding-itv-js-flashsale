import { type Kysely, sql } from "kysely";

// Placeholder table to prove the migration flow. Replace it once the real domain is known.
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

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("products").execute();
}
