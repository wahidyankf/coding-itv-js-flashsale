// Migration 0003: the holds and the purchases of a sale. A hold is a reservation with an expiry, and a purchase is a
// confirmed item that is paid for once, ever. Each names its shopper and its sale.
import { type Kysely, sql } from "kysely";

// Creates purchases, then reservations, with their live-row indexes. It promises the two tables and nothing else.
export async function up(db: Kysely<unknown>): Promise<void> {
	// A purchase is one confirmed item. reservation_id is the idempotency key of the confirm step, so it is unique for
	// good: a deleted purchase still holds its reservation.
	await db.schema
		.createTable("purchases")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("sale_id", "uuid", (col) =>
			col.notNull().references("sales.id").onDelete("restrict"),
		)
		.addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
		.addColumn("reservation_id", "uuid", (col) => col.notNull().unique())
		.addColumn("payment_ref", "text", (col) => col.notNull())
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
	// A shopper buys once per sale. A deleted row is history and no longer counts.
	await sql`create unique index purchases_one_per_user on purchases (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);

	// A reservation is a hold with an expiry. An expired row counts as free, so no sweep job is needed.
	await db.schema
		.createTable("reservations")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("sale_id", "uuid", (col) =>
			col.notNull().references("sales.id").onDelete("restrict"),
		)
		.addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
		.addColumn("expires_at", "timestamptz", (col) => col.notNull())
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
	// One live hold per shopper and sale, as for purchases.
	await sql`create unique index reservations_one_per_user on reservations (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);
}

// Drops the reservations, then the purchases. It promises that neither table is left behind.
export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable("reservations").execute();
	await db.schema.dropTable("purchases").execute();
}
