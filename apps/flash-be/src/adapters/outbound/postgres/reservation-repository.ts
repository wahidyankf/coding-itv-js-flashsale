import type { Kysely } from "kysely";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";
import type { FallbackAnswer } from "../../../domain/reservation.js";
import type { Database } from "./database.js";

export function createReservationRepository(
	db: Kysely<Database>,
): ReservationRepository {
	return {
		async hasPurchase(saleId, user) {
			const row = await db
				.selectFrom("purchases")
				.select("id")
				.where("sale_id", "=", saleId)
				.where("user_id", "=", user)
				.executeTakeFirst();
			return row !== undefined;
		},

		async save(reservation) {
			await db
				.insertInto("reservations")
				.values({
					id: reservation.reservationId,
					sale_id: reservation.saleId,
					user_id: reservation.user,
					expires_at: reservation.expiresAt,
				})
				.onConflict((conflict) =>
					conflict.columns(["sale_id", "user_id"]).doUpdateSet({
						id: reservation.reservationId,
						expires_at: reservation.expiresAt,
					}),
				)
				.execute();
		},

		async reserveWithoutRedis(request, redisReady) {
			return db.transaction().execute(async (trx): Promise<FallbackAnswer> => {
				const sale = await trx
					.selectFrom("sales")
					.select("sold")
					.where("id", "=", request.saleId)
					.forUpdate()
					.executeTakeFirstOrThrow();
				// Rebuilding takes the same lock, so after it Redis is ready and holds everything written so far.
				if (await redisReady().catch(() => false)) {
					return { kind: "redis_ready" };
				}
				const bought = await trx
					.selectFrom("purchases")
					.select("id")
					.where("sale_id", "=", request.saleId)
					.where("user_id", "=", request.user)
					.executeTakeFirst();
				if (bought) return { kind: "purchased" };

				const own = await trx
					.selectFrom("reservations")
					.select(["id", "expires_at"])
					.where("sale_id", "=", request.saleId)
					.where("user_id", "=", request.user)
					.executeTakeFirst();
				if (own && own.expires_at > request.now) {
					return {
						kind: "held",
						reservationId: own.id,
						expiresAt: own.expires_at,
					};
				}

				const live = await trx
					.selectFrom("reservations")
					.select((builder) => builder.fn.countAll<string>().as("count"))
					.where("sale_id", "=", request.saleId)
					.where("expires_at", ">", request.now)
					.where("user_id", "!=", request.user)
					.executeTakeFirstOrThrow();
				if (sale.sold + Number(live.count) >= request.stock) {
					return { kind: "sold_out" };
				}

				await trx
					.insertInto("reservations")
					.values({
						id: request.reservationId,
						sale_id: request.saleId,
						user_id: request.user,
						expires_at: request.expiresAt,
					})
					.onConflict((conflict) =>
						conflict.columns(["sale_id", "user_id"]).doUpdateSet({
							id: request.reservationId,
							expires_at: request.expiresAt,
						}),
					)
					.execute();
				return {
					kind: "reserved",
					reservationId: request.reservationId,
					expiresAt: request.expiresAt,
				};
			});
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
