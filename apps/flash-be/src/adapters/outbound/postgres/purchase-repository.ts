import { type Kysely, type Selectable, sql } from "kysely";
import type {
	CommitResult,
	PurchaseRepository,
} from "../../../application/ports/purchase-repository.js";
import type { Purchase } from "../../../domain/purchase.js";
import type { Reservation } from "../../../domain/reservation.js";
import type { Database } from "./database.js";
import { ensureUser } from "./users.js";

// A row with the name of its user, as the domain knows the user.
type Named<Row> = Selectable<Row> & { username: string };

function toPurchase(row: Named<Database["purchases"]>): Purchase {
	return {
		id: row.id,
		saleId: row.sale_id,
		user: row.username,
		reservationId: row.reservation_id,
		paymentRef: row.payment_ref,
		purchasedAt: row.created_at,
	};
}

function toReservation(row: Named<Database["reservations"]>): Reservation {
	return {
		saleId: row.sale_id,
		user: row.username,
		reservationId: row.id,
		expiresAt: row.expires_at,
	};
}

export function createPurchaseRepository(
	db: Kysely<Database>,
): PurchaseRepository {
	// The live purchases, each with the name of its buyer.
	const purchases = (from: Kysely<Database>) =>
		from
			.selectFrom("purchases")
			.innerJoin("users", "users.id", "purchases.user_id")
			.selectAll("purchases")
			.select("users.username")
			.where("purchases.deleted_at", "is", null);

	return {
		async findByReservation(reservationId) {
			const row = await purchases(db)
				.where("purchases.reservation_id", "=", reservationId)
				.executeTakeFirst();
			return row === undefined ? undefined : toPurchase(row);
		},

		async findByUser(saleId, user) {
			const row = await purchases(db)
				.where("purchases.sale_id", "=", saleId)
				.where("users.username", "=", user)
				.where("users.deleted_at", "is", null)
				.executeTakeFirst();
			return row === undefined ? undefined : toPurchase(row);
		},

		async findReservation(saleId, user) {
			const row = await db
				.selectFrom("reservations")
				.innerJoin("users", "users.id", "reservations.user_id")
				.selectAll("reservations")
				.select("users.username")
				.where("reservations.deleted_at", "is", null)
				.where("reservations.sale_id", "=", saleId)
				.where("users.username", "=", user)
				.where("users.deleted_at", "is", null)
				.executeTakeFirst();
			return row === undefined ? undefined : toReservation(row);
		},

		async commit(input) {
			return db.transaction().execute(async (trx): Promise<CommitResult> => {
				// The sale row lock lines up everyone who confirms for this sale.
				await trx
					.selectFrom("sales")
					.select("id")
					.where("id", "=", input.saleId)
					.forUpdate()
					.execute();

				const same = await purchases(trx)
					.where("purchases.reservation_id", "=", input.reservationId)
					.executeTakeFirst();
				if (same) {
					return {
						kind: "purchased",
						purchase: toPurchase(same),
						created: false,
					};
				}

				// The buyer is their own author in every row this purchase writes.
				const userId = await ensureUser(trx, input.user);
				const earlier = await trx
					.selectFrom("purchases")
					.select("id")
					.where("sale_id", "=", input.saleId)
					.where("user_id", "=", userId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				if (earlier) return { kind: "already_purchased" };

				// The last wall: the row is updated only while items remain, and the CHECK on the table repeats it.
				const updated = await trx
					.updateTable("sales")
					.set({
						sold: sql`sold + 1`,
						updated_at: sql<Date>`now()`,
						updated_by: userId,
					})
					.where("id", "=", input.saleId)
					.where("deleted_at", "is", null)
					.where(sql<boolean>`sold < stock`)
					.executeTakeFirst();
				if (updated.numUpdatedRows === 0n) return { kind: "sold_out" };

				const row = await trx
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
				// The hold is spent. It stays as a row, marked deleted by the buyer.
				await trx
					.updateTable("reservations")
					.set({ deleted_at: sql<Date>`now()`, deleted_by: userId })
					.where("sale_id", "=", input.saleId)
					.where("user_id", "=", userId)
					.where("deleted_at", "is", null)
					.execute();
				return {
					kind: "purchased",
					purchase: toPurchase({ ...row, username: input.user }),
					created: true,
				};
			});
		},
	};
}
