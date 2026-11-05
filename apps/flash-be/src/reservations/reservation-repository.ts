import type { Kysely } from "kysely";
import type { Database } from "../db.js";
import type { HoldSnapshot } from "./hold-gate.js";

export type ReservationRow = {
	saleId: string;
	user: string;
	reservationId: string;
	expiresAt: Date;
};

// Reservations are written to Postgres next to Redis. Redis decides fast; this copy is what a rebuild reads.
export type ReservationRepository = {
	// One row per user and sale. A new hold replaces an expired one.
	save(row: ReservationRow): Promise<void>;
	// Runs `restore` with the sale's purchases and live holds while the sale row is locked, so no reservation
	// can slip in between the snapshot and the moment Redis is marked ready.
	rebuild(
		saleId: string,
		now: Date,
		restore: (snapshot: HoldSnapshot) => Promise<void>,
	): Promise<void>;
};

export function createReservationRepository(
	db: Kysely<Database>,
): ReservationRepository {
	return {
		async save(row) {
			await db
				.insertInto("reservations")
				.values({
					id: row.reservationId,
					sale_id: row.saleId,
					user_id: row.user,
					expires_at: row.expiresAt,
				})
				.onConflict((conflict) =>
					conflict.columns(["sale_id", "user_id"]).doUpdateSet({
						id: row.reservationId,
						expires_at: row.expiresAt,
					}),
				)
				.execute();
		},

		async rebuild(saleId, now, restore) {
			await db.transaction().execute(async (trx) => {
				await trx
					.selectFrom("sales")
					.select("id")
					.where("id", "=", saleId)
					.forUpdate()
					.execute();
				const purchases = await trx
					.selectFrom("purchases")
					.select("user_id")
					.where("sale_id", "=", saleId)
					.execute();
				const holds = await trx
					.selectFrom("reservations")
					.select(["user_id", "id", "expires_at"])
					.where("sale_id", "=", saleId)
					.where("expires_at", ">", now)
					.execute();
				await restore({
					buyers: purchases.map((row) => row.user_id),
					holds: holds.map((row) => ({
						user: row.user_id,
						reservationId: row.id,
						expiresAt: row.expires_at,
					})),
				});
			});
		},
	};
}
