import { type Kysely, type Selectable, sql } from "kysely";
import type { Database } from "../db.js";
import type { ReservationRow } from "../reservations/reservation-repository.js";

export type Purchase = {
	id: string;
	saleId: string;
	user: string;
	reservationId: string;
	paymentRef: string;
	purchasedAt: Date;
};

export type CommitInput = {
	saleId: string;
	user: string;
	reservationId: string;
	paymentRef: string;
};

export type CommitResult =
	| { kind: "purchased"; purchase: Purchase; created: boolean }
	| { kind: "sold_out" }
	| { kind: "already_purchased" };

export type PurchaseRepository = {
	findByReservation(reservationId: string): Promise<Purchase | undefined>;
	findByUser(saleId: string, user: string): Promise<Purchase | undefined>;
	// The reservation row of this user, with any expiry. The service decides what an old one means.
	findReservation(
		saleId: string,
		user: string,
	): Promise<ReservationRow | undefined>;
	// Turns a hold into a purchase in one transaction under a lock on the sale row.
	commit(input: CommitInput): Promise<CommitResult>;
};

function toPurchase(row: Selectable<Database["purchases"]>): Purchase {
	return {
		id: row.id,
		saleId: row.sale_id,
		user: row.user_id,
		reservationId: row.reservation_id,
		paymentRef: row.payment_ref,
		purchasedAt: row.created_at,
	};
}

export function createPurchaseRepository(
	db: Kysely<Database>,
): PurchaseRepository {
	return {
		async findByReservation(reservationId) {
			const row = await db
				.selectFrom("purchases")
				.selectAll()
				.where("reservation_id", "=", reservationId)
				.executeTakeFirst();
			return row ? toPurchase(row) : undefined;
		},

		async findByUser(saleId, user) {
			const row = await db
				.selectFrom("purchases")
				.selectAll()
				.where("sale_id", "=", saleId)
				.where("user_id", "=", user)
				.executeTakeFirst();
			return row ? toPurchase(row) : undefined;
		},

		async findReservation(saleId, user) {
			const row = await db
				.selectFrom("reservations")
				.selectAll()
				.where("sale_id", "=", saleId)
				.where("user_id", "=", user)
				.executeTakeFirst();
			return row
				? {
						saleId: row.sale_id,
						user: row.user_id,
						reservationId: row.id,
						expiresAt: row.expires_at,
					}
				: undefined;
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

				const same = await trx
					.selectFrom("purchases")
					.selectAll()
					.where("reservation_id", "=", input.reservationId)
					.executeTakeFirst();
				if (same) {
					return {
						kind: "purchased",
						purchase: toPurchase(same),
						created: false,
					};
				}

				const earlier = await trx
					.selectFrom("purchases")
					.select("id")
					.where("sale_id", "=", input.saleId)
					.where("user_id", "=", input.user)
					.executeTakeFirst();
				if (earlier) return { kind: "already_purchased" };

				// The last wall: the row is updated only while items remain, and the CHECK on the table repeats it.
				const updated = await trx
					.updateTable("sales")
					.set({ sold: sql`sold + 1` })
					.where("id", "=", input.saleId)
					.where(sql<boolean>`sold < stock`)
					.executeTakeFirst();
				if (updated.numUpdatedRows === 0n) return { kind: "sold_out" };

				const row = await trx
					.insertInto("purchases")
					.values({
						sale_id: input.saleId,
						user_id: input.user,
						reservation_id: input.reservationId,
						payment_ref: input.paymentRef,
					})
					.returningAll()
					.executeTakeFirstOrThrow();
				await trx
					.deleteFrom("reservations")
					.where("sale_id", "=", input.saleId)
					.where("user_id", "=", input.user)
					.execute();
				return { kind: "purchased", purchase: toPurchase(row), created: true };
			});
		},
	};
}
