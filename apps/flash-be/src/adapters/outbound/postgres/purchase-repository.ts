// Purchases and their holds, kept in Postgres. Postgres has the last word on the stock: a purchase is written in the same
// transaction that locks the sale and checks the sold count, so the sale cannot oversell and a shopper cannot buy twice.
// Outbound Postgres adapter for the PurchaseRepository port. The choice is recorded in decision 002.
import { type Kysely, type Selectable, sql } from "kysely";
import type {
	CommitInput,
	CommitResult,
	PurchaseRepository,
} from "../../../application/ports/purchase-repository.js";
import type { Purchase } from "../../../domain/purchase.js";
import type { Reservation } from "../../../domain/reservation.js";
import { storedUsername } from "../../../domain/user.js";
import type { Database } from "./database.js";
import {
	dbNow,
	live,
	livePurchaseOf,
	lockLiveSale,
	purchasesWithBuyer,
	reservationsWithUser,
} from "./queries.js";
import { ensureUser } from "./users.js";

// A row with the name of its user, as the domain knows the user.
type Named<Row> = Selectable<Row> & { username: string };

// A purchase row, as the domain knows it.
function toPurchase(row: Named<Database["purchases"]>): Purchase {
	return {
		id: row.id,
		saleId: row.sale_id,
		user: storedUsername(row.username),
		reservationId: row.reservation_id,
		paymentRef: row.payment_ref,
		purchasedAt: row.created_at,
	};
}

// A hold row, as the domain knows it.
function toReservation(row: Named<Database["reservations"]>): Reservation {
	return {
		saleId: row.sale_id,
		user: storedUsername(row.username),
		reservationId: row.id,
		expiresAt: row.expires_at,
	};
}

// The purchase made with this reservation id, if any. A retried payment finds its purchase this way.
async function purchaseByReservation(
	db: Kysely<Database>,
	reservationId: string,
): Promise<Purchase | undefined> {
	const row = await purchasesWithBuyer(db)
		.where("purchases.reservation_id", "=", reservationId)
		.executeTakeFirst();
	return row === undefined ? undefined : toPurchase(row);
}

// The purchase of this shopper in this sale, if any.
async function purchaseOf(
	db: Kysely<Database>,
	saleId: string,
	user: string,
): Promise<Purchase | undefined> {
	const row = await livePurchaseOf(db, saleId, user);
	return row === undefined ? undefined : toPurchase(row);
}

// The live hold of this shopper in this sale, with its expiry. The service decides what an old expiry means.
async function holdOf(
	db: Kysely<Database>,
	saleId: string,
	user: string,
): Promise<Reservation | undefined> {
	const row = await reservationsWithUser(db)
		.where("reservations.sale_id", "=", saleId)
		.where("users.username", "=", user)
		.executeTakeFirst();
	return row === undefined ? undefined : toReservation(row);
}

// The sold count goes up by one, unless the sale is sold out. The row is updated only while items remain, and the CHECK
// on the sales table repeats the same rule. Returns false when the sale had no item left.
async function takeItem(
	trx: Kysely<Database>,
	saleId: string,
	userId: string,
): Promise<boolean> {
	const updated = await trx
		.updateTable("sales")
		.set({
			sold: sql`sold + 1`,
			updated_at: dbNow,
			updated_by: userId,
		})
		.where("id", "=", saleId)
		.where(live("sales"))
		.where(sql<boolean>`sold < stock`)
		.executeTakeFirst();
	return updated.numUpdatedRows !== 0n;
}

// Writes the purchase row. The buyer is its author.
async function insertPurchase(
	trx: Kysely<Database>,
	input: CommitInput,
	userId: string,
) {
	return trx
		.insertInto("purchases")
		.values({
			sale_id: input.saleId,
			user_id: userId,
			reservation_id: input.reservationId,
			payment_ref: input.paymentRef,
			created_by: userId,
		})
		.returningAll()
		.executeTakeFirstOrThrow();
}

// The hold is spent. It stays as a row, marked deleted by the buyer.
async function spendHold(
	trx: Kysely<Database>,
	saleId: string,
	userId: string,
): Promise<void> {
	await trx
		.updateTable("reservations")
		.set({ deleted_at: dbNow, deleted_by: userId })
		.where("sale_id", "=", saleId)
		.where("user_id", "=", userId)
		.where(live("reservations"))
		.execute();
}

// Turns a hold into a purchase in one transaction. The sale row is locked first, so the checks and the writes of two
// confirmations for one sale take turns. The steps run in this order, and the order is the rule.
async function commitPurchase(
	db: Kysely<Database>,
	input: CommitInput,
): Promise<CommitResult> {
	return db.transaction().execute(async (trx): Promise<CommitResult> => {
		await lockLiveSale(trx, input.saleId);

		// A retry of a paid hold gets its purchase back, and nothing is written twice.
		const same = await purchaseByReservation(trx, input.reservationId);
		if (same) return { kind: "purchased", purchase: same, created: false };

		// The buyer is their own author in every row this purchase writes.
		const userId = await ensureUser(trx, input.user);
		// The one-item rule. The partial unique index on purchases (one live row per shopper and sale) is the wall behind
		// this check, so a second purchase cannot be written even if the check is ever skipped.
		if (await livePurchaseOf(trx, input.saleId, input.user)) {
			return { kind: "already_purchased" };
		}
		// The stock wall. The sold count is updated only while items remain.
		if (!(await takeItem(trx, input.saleId, userId))) {
			return { kind: "sold_out" };
		}

		const row = await insertPurchase(trx, input, userId);
		await spendHold(trx, input.saleId, userId);
		return {
			kind: "purchased",
			purchase: toPurchase({ ...row, username: input.user }),
			created: true,
		};
	});
}

// The purchase repository over Postgres. The reads return what the domain needs, and `commit` is the one write.
export function createPurchaseRepository(
	db: Kysely<Database>,
): PurchaseRepository {
	return {
		findByReservation: (reservationId) =>
			purchaseByReservation(db, reservationId),
		findByUser: (saleId, user) => purchaseOf(db, saleId, user),
		findReservation: (saleId, user) => holdOf(db, saleId, user),
		commit: (input) => commitPurchase(db, input),
	};
}
