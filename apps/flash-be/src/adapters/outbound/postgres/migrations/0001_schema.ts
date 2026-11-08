// Migration 0001: the whole schema of the flash sale, in one step. It builds the users (with the system user that acts
// when no person does), the products and the sales with the rules that keep a sale from selling more than its stock, the
// holds and the purchases of a sale, the sessions of logins, and the mock payment provider's ledger. Every table has the six audit columns, nothing is ever
// erased, and every unique rule on a live row is a partial index (decision 011). Postgres has the last word on
// overselling, whatever Redis says.
import { type CreateTableBuilder, type Kysely, sql } from "kysely";

// The system user's name. The migration keeps its own copy, so it never reads live code. The name starts with `$`, which
// a shopper's user id cannot contain, so no shopper can take it. `domain/actors.ts` repeats the name; a test keeps them equal.
const SYSTEM_USERNAME = "$system";

// The defaults of the two sale columns, frozen here: a migration never reads a live default, or an old database would
// change with the code.
const HOLD_SECONDS_DEFAULT = 120;
const ADMIT_PER_SECOND_DEFAULT = 50;

// The id column every table starts with: a UUID that Postgres makes when the code gives none.
function withId<TB extends string>(table: CreateTableBuilder<TB>) {
	return table.addColumn("id", "uuid", (col) =>
		col.primaryKey().defaultTo(sql`gen_random_uuid()`),
	);
}

// The six audit columns every table ends with: who made, changed and removed the row, and when. The `*_by` columns point
// at users.
function withAudit<TB extends string, C extends string>(
	table: CreateTableBuilder<TB, C>,
) {
	return table
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("created_by", "uuid", (col) =>
			col.notNull().references("users.id"),
		)
		.addColumn("updated_at", "timestamptz")
		.addColumn("updated_by", "uuid", (col) => col.references("users.id"))
		.addColumn("deleted_at", "timestamptz")
		.addColumn("deleted_by", "uuid", (col) => col.references("users.id"));
}

// The users, the index that keeps live names unique, and the system user. Every other table refers to a user, so this
// comes first.
async function createUsers(db: Kysely<unknown>): Promise<void> {
	await withAudit(
		withId(db.schema.createTable("users"))
			.addColumn("username", "text", (col) => col.notNull())
			// Empty for a user that cannot log in, such as the system.
			.addColumn("password_hash", "text")
			.addColumn("role", "text", (col) => col.notNull().defaultTo("shopper"))
			// When the user last logged in, for the operator who wonders whether an account is still used.
			.addColumn("last_login_at", "timestamptz"),
	)
		.addCheckConstraint(
			"users_role_known",
			sql`role in ('shopper', 'operator')`,
		)
		.execute();

	// A name is free again once its user is deleted.
	await sql`create unique index users_username_live on users (username) where deleted_at is null`.execute(
		db,
	);

	// The system is its own author: no user exists before it, so it names itself.
	await sql`insert into users (id, username, created_by)
		select id, ${SYSTEM_USERNAME}, id from (select gen_random_uuid() as id) as fresh`.execute(
		db,
	);
}

// The products that are sold, and the sales of them. A sale refers to its product, and neither is erased while the other
// still uses it.
async function createProductsAndSales(db: Kysely<unknown>): Promise<void> {
	await withAudit(
		withId(db.schema.createTable("products")).addColumn("name", "text", (col) =>
			col.notNull(),
		),
	).execute();

	await withAudit(
		withId(db.schema.createTable("sales"))
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
			),
	)
		.addCheckConstraint("sales_stock_not_negative", sql`stock >= 0`)
		.addCheckConstraint("sales_sold_within_stock", sql`sold <= stock`)
		.addCheckConstraint("sales_window_is_ordered", sql`ends_at > starts_at`)
		.execute();
}

// The purchases and the holds of a sale. A hold is a reservation with an expiry, and a purchase is a confirmed item that
// is paid for once, ever. Each names its shopper and its sale.
async function createPurchasesAndHolds(db: Kysely<unknown>): Promise<void> {
	// reservation_id is the idempotency key of the confirm step, so it is unique for good: a deleted purchase still holds
	// its reservation.
	await withAudit(
		withId(db.schema.createTable("purchases"))
			.addColumn("sale_id", "uuid", (col) =>
				col.notNull().references("sales.id").onDelete("restrict"),
			)
			.addColumn("user_id", "uuid", (col) =>
				col.notNull().references("users.id"),
			)
			.addColumn("reservation_id", "uuid", (col) => col.notNull().unique())
			.addColumn("payment_ref", "text", (col) => col.notNull()),
	).execute();
	// A shopper buys once per sale. A deleted row is history and no longer counts.
	await sql`create unique index purchases_one_per_user on purchases (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);

	// An expired hold counts as free by its time, so no sweep job is needed. A hold taken again gets a row of its own, and
	// the old row is marked deleted.
	await withAudit(
		withId(db.schema.createTable("reservations"))
			.addColumn("sale_id", "uuid", (col) =>
				col.notNull().references("sales.id").onDelete("restrict"),
			)
			.addColumn("user_id", "uuid", (col) =>
				col.notNull().references("users.id"),
			)
			.addColumn("expires_at", "timestamptz", (col) => col.notNull()),
	).execute();
	// One live hold per shopper and sale, as for purchases.
	await sql`create unique index reservations_one_per_user on reservations (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);
	// The holds of a sale that still count, found by their end: the Postgres fallback counts them on every reservation
	// while Redis is down, and a rebuild reads them. Without it, both read every live row the sale ever had, expired or not.
	await sql`create index reservations_live_by_expiry on reservations (sale_id, expires_at) where deleted_at is null`.execute(
		db,
	);
}

// The sessions of logins. A session holds the two tokens of one login: a short access token, and a long refresh token
// that is replaced each time it is used. Only the SHA-256 of a token is stored, so a copy of the database cannot be used
// to act as a user. A session that ends is marked deleted.
async function createSessions(db: Kysely<unknown>): Promise<void> {
	await withAudit(
		withId(db.schema.createTable("sessions"))
			.addColumn("user_id", "uuid", (col) =>
				col.notNull().references("users.id").onDelete("restrict"),
			)
			.addColumn("access_hash", "text", (col) => col.notNull())
			.addColumn("access_expires_at", "timestamptz", (col) => col.notNull())
			.addColumn("refresh_hash", "text", (col) => col.notNull())
			.addColumn("refresh_expires_at", "timestamptz", (col) => col.notNull())
			// The refresh token before the last one. If it comes back, it was stolen or replayed, and the session ends.
			.addColumn("previous_refresh_hash", "text")
			// Where the login came from, so a user (or an operator) can recognise a session that is not theirs.
			.addColumn("ip", "text")
			.addColumn("user_agent", "text"),
	).execute();
	// A live token is unique, so no two live sessions share one.
	await sql`create unique index sessions_access_live on sessions (access_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create unique index sessions_refresh_live on sessions (refresh_hash) where deleted_at is null`.execute(
		db,
	);
	await sql`create index sessions_user on sessions (user_id)`.execute(db);
	// The replay check of a refresh, and a logout, look a live session up by its previous refresh token. Sessions are never
	// erased, so without it each of them reads the whole table.
	await sql`create index sessions_previous_refresh_live on sessions (previous_refresh_hash) where deleted_at is null`.execute(
		db,
	);
}

// The mock payment provider's own ledger, one row per reservation id (decision 009). The provider is the system actor, so
// the system user is the author of every row. The reservation id is the idempotency key, unique for good, like
// `purchases.reservation_id`; each charge has a ref of its own.
async function createPayments(db: Kysely<unknown>): Promise<void> {
	await withAudit(
		withId(db.schema.createTable("payments"))
			.addColumn("reservation_id", "uuid", (col) => col.notNull().unique())
			.addColumn("status", "text", (col) => col.notNull())
			.addColumn("ref", "text", (col) => col.unique())
			// How many settles wrote the row: a decline and the charge after it are two.
			.addColumn("attempts", "integer", (col) => col.notNull().defaultTo(1)),
	)
		.addCheckConstraint(
			"payments_status_known",
			sql`status in ('charged', 'declined', 'refunded')`,
		)
		.addCheckConstraint(
			"payments_charged_has_ref",
			sql`status <> 'charged' or ref is not null`,
		)
		.execute();
}

// Builds every table, in the order their references need. It promises the whole schema and the system user.
export async function up(db: Kysely<unknown>): Promise<void> {
	await createUsers(db);
	await createProductsAndSales(db);
	await createPurchasesAndHolds(db);
	await createSessions(db);
	await createPayments(db);
}

// Drops every table, in the reverse order. It promises that no table of the schema is left behind.
export async function down(db: Kysely<unknown>): Promise<void> {
	for (const table of [
		"payments",
		"sessions",
		"reservations",
		"purchases",
		"sales",
		"products",
		"users",
	]) {
		await db.schema.dropTable(table).execute();
	}
}
