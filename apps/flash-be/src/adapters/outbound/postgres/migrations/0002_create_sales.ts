import { type Kysely, sql } from "kysely";

// The sale schema. Postgres is the source of truth: the constraints below are the last wall against
// overselling and against a user buying twice, whatever Redis said.
export async function up(db: Kysely<unknown>): Promise<void> {
	// The placeholder table from the first migration is replaced by the real domain.
	await db.schema.dropTable("products").execute();

	await db.schema
		.createTable("sales")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("starts_at", "timestamptz", (col) => col.notNull())
		.addColumn("ends_at", "timestamptz", (col) => col.notNull())
		.addColumn("stock", "integer", (col) => col.notNull())
		.addColumn("sold", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("reservation_ttl_seconds", "integer", (col) =>
			col.notNull().defaultTo(120),
		)
		.addColumn("admit_per_second", "integer", (col) =>
			col.notNull().defaultTo(50),
		)
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addCheckConstraint("sales_stock_not_negative", sql`stock >= 0`)
		.addCheckConstraint("sales_sold_within_stock", sql`sold <= stock`)
		.addCheckConstraint("sales_window_is_ordered", sql`ends_at > starts_at`)
		.execute();

	// A purchase is one confirmed item. reservation_id is the idempotency key of the confirm step.
	await db.schema
		.createTable("purchases")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("sale_id", "uuid", (col) =>
			col.notNull().references("sales.id").onDelete("cascade"),
		)
		.addColumn("user_id", "text", (col) => col.notNull())
		.addColumn("reservation_id", "uuid", (col) => col.notNull().unique())
		.addColumn("payment_ref", "text", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addUniqueConstraint("purchases_one_per_user", ["sale_id", "user_id"])
		.execute();

	// A reservation is a hold with an expiry. An expired row counts as free, so no sweep job is needed.
	await db.schema
		.createTable("reservations")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("sale_id", "uuid", (col) =>
			col.notNull().references("sales.id").onDelete("cascade"),
		)
		.addColumn("user_id", "text", (col) => col.notNull())
		.addColumn("expires_at", "timestamptz", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addUniqueConstraint("reservations_one_per_user", ["sale_id", "user_id"])
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("reservations").execute();
	await db.schema.dropTable("purchases").execute();
	await db.schema.dropTable("sales").execute();

	// Restore the placeholder table so the schema is exactly what the first migration left.
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
