// Queries that the purchase and the reservation repositories share. Each one names the rows it leaves out, so the two
// repositories cannot disagree about what "live" means. Outbound Postgres adapter.
import type { Kysely } from "kysely";
import type { Database } from "./database.js";

// The live purchases, each with the name of its buyer. Every read of a purchase starts from here.
export function purchasesWithBuyer(from: Kysely<Database>) {
	return from
		.selectFrom("purchases")
		.innerJoin("users", "users.id", "purchases.user_id")
		.selectAll("purchases")
		.select("users.username")
		.where("purchases.deleted_at", "is", null);
}

// The live holds, each with the name of its user. The expiry is left to the caller, because a rebuild and a reserve
// read it with different meanings.
export function reservationsWithUser(from: Kysely<Database>) {
	return from
		.selectFrom("reservations")
		.innerJoin("users", "users.id", "reservations.user_id")
		.selectAll("reservations")
		.select("users.username")
		.where("reservations.deleted_at", "is", null);
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
		.where("users.deleted_at", "is", null)
		.executeTakeFirst();
}

// Locks the row of a sale until the transaction ends. Work on one sale that takes this lock runs one step at a time.
export async function lockSaleRow(
	trx: Kysely<Database>,
	saleId: string,
): Promise<void> {
	await trx
		.selectFrom("sales")
		.select("id")
		.where("id", "=", saleId)
		.forUpdate()
		.execute();
}
