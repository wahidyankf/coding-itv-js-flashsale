// Migration 0003: users, products and the audit columns. It adds the operator and system stand-in users, and moves the
// text user ids of the old tables to user rows. Nothing is erased.
import { type Kysely, sql } from "kysely";

// Frozen here, as a migration never reads live code. `domain/actors.ts` repeats the names; a test keeps them equal.
// The names start with `$`, which a shopper's user id cannot contain, so no shopper can take them. The rows are found
// by name, so no id is written anywhere.
const SYSTEM_USERNAME = "$system";
const OPERATOR_USERNAME = "$operator";
const SYSTEM = sql`(select id from users where username = ${SYSTEM_USERNAME})`;

// A row is never erased: the columns say who made it, who changed it and who deleted it. A change or a deletion is
// empty until it happens.
const AUDIT_COLUMNS = [
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
	"deleted_at",
	"deleted_by",
] as const;

// The tables that get the missing columns here. `sales`, `purchases` and `reservations` already have `created_at`.
const OLD_TABLES = ["sales", "purchases", "reservations"] as const;
const ADDED_COLUMNS = AUDIT_COLUMNS.filter((name) => name !== "created_at");

// Adds the five columns an old table lacks. `created_by` stays empty until the backfill, then becomes required.
async function addAuditColumns(
	db: Kysely<unknown>,
	table: (typeof OLD_TABLES)[number],
): Promise<void> {
	for (const name of ADDED_COLUMNS) {
		const kind = name.endsWith("_at") ? "timestamptz" : "uuid";
		await db.schema
			.alterTable(table)
			.addColumn(name, kind, (col) =>
				kind === "uuid" ? col.references("users.id") : col,
			)
			.execute();
	}
}

async function requireCreator(
	db: Kysely<unknown>,
	table: (typeof OLD_TABLES)[number],
): Promise<void> {
	await db.schema
		.alterTable(table)
		.alterColumn("created_by", (col) => col.setNotNull())
		.execute();
}

async function dropAuditColumns(
	db: Kysely<unknown>,
	table: (typeof OLD_TABLES)[number],
): Promise<void> {
	for (const name of ADDED_COLUMNS) {
		await db.schema.alterTable(table).dropColumn(name).execute();
	}
}

// Creates users and products, adds the audit columns to the sale tables, and links every row to a user.
export async function up(db: Kysely<unknown>): Promise<void> {
	// users. `created_by` points at users, so the system row is its own author.
	await db.schema
		.createTable("users")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("username", "text", (col) => col.notNull())
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
	// A name is free again once its user is deleted.
	await sql`create unique index users_username_live on users (username) where deleted_at is null`.execute(
		db,
	);
	// The system is its own author. The operator is made by the system.
	await sql`insert into users (id, username, created_by)
		select id, ${SYSTEM_USERNAME}, id from (select gen_random_uuid() as id) as fresh`.execute(
		db,
	);
	await sql`insert into users (username, created_by) values (${OPERATOR_USERNAME}, ${SYSTEM})`.execute(
		db,
	);

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

	// sales: every old sale gets a product of its own, named like the sale.
	for (const table of OLD_TABLES) await addAuditColumns(db, table);
	await db.schema.alterTable("sales").addColumn("product_id", "uuid").execute();
	await sql`update sales set product_id = gen_random_uuid(), created_by = ${SYSTEM}`.execute(
		db,
	);
	await sql`insert into products (id, name, created_at, created_by)
		select product_id, name, created_at, created_by from sales`.execute(db);
	await db.schema
		.alterTable("sales")
		.alterColumn("product_id", (col) => col.setNotNull())
		.execute();
	await sql`alter table sales add constraint sales_product_id_fkey
		foreign key (product_id) references products (id) on delete restrict`.execute(
		db,
	);
	await requireCreator(db, "sales");

	// users of the old rows: one user per user id that ever held or bought.
	await sql`insert into users (username, created_by)
		select name, ${SYSTEM}
		from (select user_id as name from purchases union select user_id from reservations) as names`.execute(
		db,
	);

	for (const table of ["purchases", "reservations"] as const) {
		await db.schema.alterTable(table).addColumn("user_uuid", "uuid").execute();
		await sql`update ${sql.table(table)} as t set user_uuid = u.id, created_by = u.id
			from users as u where u.username = t.user_id and u.deleted_at is null`.execute(
			db,
		);
		// The old unique constraint on (sale_id, user_id) goes with the old column.
		await db.schema.alterTable(table).dropColumn("user_id").execute();
		await db.schema
			.alterTable(table)
			.renameColumn("user_uuid", "user_id")
			.execute();
		await db.schema
			.alterTable(table)
			.alterColumn("user_id", (col) => col.setNotNull())
			.execute();
		await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_user_id_fkey`)}
			foreign key (user_id) references users (id)`.execute(db);
		await requireCreator(db, table);
		// Nothing is erased, so a sale is never removed from under its rows.
		await sql`alter table ${sql.table(table)} drop constraint ${sql.id(`${table}_sale_id_fkey`)}`.execute(
			db,
		);
		await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_sale_id_fkey`)}
			foreign key (sale_id) references sales (id) on delete restrict`.execute(
			db,
		);
	}

	// One live row per shopper and sale. A deleted row is history and no longer counts.
	await sql`create unique index purchases_one_per_user on purchases (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);
	await sql`create unique index reservations_one_per_user on reservations (sale_id, user_id) where deleted_at is null`.execute(
		db,
	);
}

// Puts the text user ids and the schema of migration 0002 back. Rows that were deleted are dropped here, and only here.
export async function down(db: Kysely<unknown>): Promise<void> {
	// An older schema keeps no deleted rows, so they are removed before the columns go.
	await sql`delete from reservations where deleted_at is not null`.execute(db);
	await sql`delete from purchases where deleted_at is not null`.execute(db);
	await sql`delete from sales where deleted_at is not null and not exists
		(select 1 from purchases where purchases.sale_id = sales.id)`.execute(db);

	for (const table of ["reservations", "purchases"] as const) {
		await sql`drop index ${sql.id(`${table}_one_per_user`)}`.execute(db);
		await sql`alter table ${sql.table(table)} drop constraint ${sql.id(`${table}_sale_id_fkey`)}`.execute(
			db,
		);
		await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_sale_id_fkey`)}
			foreign key (sale_id) references sales (id) on delete cascade`.execute(
			db,
		);
		await db.schema.alterTable(table).addColumn("user_text", "text").execute();
		await sql`update ${sql.table(table)} as t set user_text = u.username
			from users as u where u.id = t.user_id`.execute(db);
		await db.schema.alterTable(table).dropColumn("user_id").execute();
		await db.schema
			.alterTable(table)
			.renameColumn("user_text", "user_id")
			.execute();
		await db.schema
			.alterTable(table)
			.alterColumn("user_id", (col) => col.setNotNull())
			.execute();
		await dropAuditColumns(db, table);
		await sql`alter table ${sql.table(table)} add constraint ${sql.id(`${table}_one_per_user`)}
			unique (sale_id, user_id)`.execute(db);
	}

	await sql`alter table sales drop constraint sales_product_id_fkey`.execute(
		db,
	);
	await db.schema.alterTable("sales").dropColumn("product_id").execute();
	await dropAuditColumns(db, "sales");
	await db.schema.dropTable("products").execute();
	await db.schema.dropTable("users").execute();
}
