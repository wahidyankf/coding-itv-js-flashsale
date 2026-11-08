// Migration 0002: the products that are sold, and the sales of them, with the rules that keep a sale from selling more
// than its stock. Postgres has the last word on overselling, whatever Redis says.
import { type Kysely, sql } from "kysely";

// The defaults of the two sale columns, frozen here: a migration never reads a live default, or an old database would
// change with the code.
const HOLD_SECONDS_DEFAULT = 120;
const ADMIT_PER_SECOND_DEFAULT = 50;

// Creates products and sales. A sale refers to its product, and neither is erased while the other still uses it.
// It promises the two tables and their rules, and nothing else.
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
		.addColumn("created_by", "uuid", (col) =>
			col.notNull().references("users.id"),
		)
		.addColumn("updated_at", "timestamptz")
		.addColumn("updated_by", "uuid", (col) => col.references("users.id"))
		.addColumn("deleted_at", "timestamptz")
		.addColumn("deleted_by", "uuid", (col) => col.references("users.id"))
		.execute();

	await db.schema
		.createTable("sales")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("product_id", "uuid", (col) =>
			col.notNull().references("products.id").onDelete("restrict"),
		)
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("starts_at", "timestamptz", (col) => col.notNull())
		.addColumn("ends_at", "timestamptz", (col) => col.notNull())
		.addColumn("stock", "integer", (col) => col.notNull())
		.addColumn("sold", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("reservation_ttl_seconds", "integer", (col) =>
			col.notNull().defaultTo(HOLD_SECONDS_DEFAULT),
		)
		.addColumn("admit_per_second", "integer", (col) =>
			col.notNull().defaultTo(ADMIT_PER_SECOND_DEFAULT),
		)
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("created_by", "uuid", (col) =>
			col.notNull().references("users.id"),
		)
		.addColumn("updated_at", "timestamptz")
		.addColumn("updated_by", "uuid", (col) => col.references("users.id"))
		.addColumn("deleted_at", "timestamptz")
		.addColumn("deleted_by", "uuid", (col) => col.references("users.id"))
		.addCheckConstraint("sales_stock_not_negative", sql`stock >= 0`)
		.addCheckConstraint("sales_sold_within_stock", sql`sold <= stock`)
		.addCheckConstraint("sales_window_is_ordered", sql`ends_at > starts_at`)
		.execute();
}

// Drops the sales, then the products they refer to. It promises that neither table is left behind.
export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("sales").execute();
	await db.schema.dropTable("products").execute();
}
