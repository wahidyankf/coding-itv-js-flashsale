// The shared pieces of the Postgres adapters (outbound Postgres adapter): the live-row condition every read adds, the
// database clock for the audit columns, and the queries that the purchase and the reservation repositories share. Each
// shared query names the rows it leaves out, so the repositories cannot disagree about what "live" means, and a rebuild
// snapshot matches the live checks.
import { type Kysely, sql } from "kysely";
import type { Database } from "./database.js";

// The tables that a removal marks with `deleted_at`. A row of one of them is live while that column is empty.
export type SoftDeletedTable =
	| "users"
	| "sessions"
	| "products"
	| "sales"
	| "purchases"
	| "reservations";

// The condition that a row of `table` is live: its `deleted_at` is empty. Every read adds it, so a removed row never
// shows. The column is named with its table, so the same condition holds inside a join.
export const live = (table: SoftDeletedTable) =>
	sql<boolean>`${sql.ref(`${table}.deleted_at`)} is null`;

// The database's clock, for the audit columns and the deletion marks. Every write stamps with it, so the times agree.
export const dbNow = sql<Date>`now()`;

// The live purchases, each with the name of its buyer. A purchase of a removed user is left out here, as the live checks
// leave it out. Every read of a purchase starts from here.
export function purchasesWithBuyer(from: Kysely<Database>) {
	return from
		.selectFrom("purchases")
		.innerJoin("users", "users.id", "purchases.user_id")
		.selectAll("purchases")
		.select("users.username")
		.where(live("purchases"))
		.where(live("users"));
}

// The live holds, each with the name of its user. A hold of a removed user is left out here too. The expiry is left to
// the caller, because a rebuild and a reserve read it with different meanings.
export function reservationsWithUser(from: Kysely<Database>) {
	return from
		.selectFrom("reservations")
		.innerJoin("users", "users.id", "reservations.user_id")
		.selectAll("reservations")
		.select("users.username")
		.where(live("reservations"))
		.where(live("users"));
}

// The live purchase of this shopper in this sale, if any. The partial unique index on purchases allows one live row per
// shopper and sale, so there is at most one.
export function livePurchaseOf(
	from: Kysely<Database>,
	saleId: string,
	username: string,
) {
	return purchasesWithBuyer(from)
		.where("purchases.sale_id", "=", saleId)
		.where("users.username", "=", username)
		.executeTakeFirst();
}

// Locks the row of a live sale until the transaction ends, and returns the row. Work on one sale that takes this lock runs
// one step at a time. A removed sale has no live row, so there is nothing to lock and nothing comes back.
export function lockLiveSale(trx: Kysely<Database>, saleId: string) {
	return trx
		.selectFrom("sales")
		.selectAll()
		.where("id", "=", saleId)
		.where(live("sales"))
		.forUpdate()
		.executeTakeFirst();
}
