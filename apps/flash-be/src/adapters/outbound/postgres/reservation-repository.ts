import { attemptAsync } from "@flash/typekit";
import { type Kysely, sql } from "kysely";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";
import type { FallbackAnswer } from "../../../domain/reservation.js";
import { hasRoom } from "../../../domain/sale.js";
import { isLive } from "../../../domain/time.js";
import type { Database } from "./database.js";
import { ensureUser } from "./users.js";

// Saves or renews the hold of one user. A shopper has at most one live hold in a sale; a renewal keeps the row and
// records who renewed it. Only live rows count, so the conflict names the same partial index.
async function upsertHold(
	db: Kysely<Database>,
	hold: {
		id: string;
		saleId: string;
		userId: string;
		expiresAt: Date;
	},
): Promise<void> {
	await db
		.insertInto("reservations")
		.values({
			id: hold.id,
			sale_id: hold.saleId,
			user_id: hold.userId,
			expires_at: hold.expiresAt,
			created_by: hold.userId,
		})
		.onConflict((conflict) =>
			conflict
				.columns(["sale_id", "user_id"])
				.where("deleted_at", "is", null)
				.doUpdateSet({
					id: hold.id,
					expires_at: hold.expiresAt,
					updated_at: sql<Date>`now()`,
					updated_by: hold.userId,
				}),
		)
		.execute();
}

export function createReservationRepository(
	db: Kysely<Database>,
): ReservationRepository {
	return {
		async hasPurchase(saleId, user) {
			const row = await db
				.selectFrom("purchases")
				.innerJoin("users", "users.id", "purchases.user_id")
				.select("purchases.id")
				.where("purchases.sale_id", "=", saleId)
				.where("purchases.deleted_at", "is", null)
				.where("users.username", "=", user)
				.where("users.deleted_at", "is", null)
				.executeTakeFirst();
			return row !== undefined;
		},

		async save(reservation) {
			const userId = await ensureUser(db, reservation.user);
			await upsertHold(db, {
				id: reservation.reservationId,
				saleId: reservation.saleId,
				userId,
				expiresAt: reservation.expiresAt,
			});
		},

		async reserveWithoutRedis(request, redisReady) {
			return db.transaction().execute(async (trx): Promise<FallbackAnswer> => {
				const sale = await trx
					.selectFrom("sales")
					.select("sold")
					.where("id", "=", request.saleId)
					.where("deleted_at", "is", null)
					.forUpdate()
					.executeTakeFirstOrThrow();
				// Rebuilding takes the same lock, so after it Redis is ready and holds everything written so far.
				const ready = await attemptAsync(redisReady, Error);
				if (ready.isOk() && ready.value) return { kind: "redis_ready" };
				const userId = await ensureUser(trx, request.user);
				const bought = await trx
					.selectFrom("purchases")
					.select("id")
					.where("sale_id", "=", request.saleId)
					.where("user_id", "=", userId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				if (bought) return { kind: "purchased" };

				const own = await trx
					.selectFrom("reservations")
					.select(["id", "expires_at"])
					.where("sale_id", "=", request.saleId)
					.where("user_id", "=", userId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				if (own && isLive({ expiresAt: own.expires_at }, request.now)) {
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
					.where("deleted_at", "is", null)
					.where("expires_at", ">", request.now)
					.where("user_id", "!=", userId)
					.executeTakeFirstOrThrow();
				if (!hasRoom(sale.sold, Number(live.count), request.stock)) {
					return { kind: "sold_out" };
				}

				await upsertHold(trx, {
					id: request.reservationId,
					saleId: request.saleId,
					userId,
					expiresAt: request.expiresAt,
				});
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
					.innerJoin("users", "users.id", "purchases.user_id")
					.select("users.username")
					.where("purchases.sale_id", "=", saleId)
					.where("purchases.deleted_at", "is", null)
					.execute();
				const holds = await trx
					.selectFrom("reservations")
					.innerJoin("users", "users.id", "reservations.user_id")
					.select([
						"users.username",
						"reservations.id",
						"reservations.expires_at",
					])
					.where("reservations.sale_id", "=", saleId)
					.where("reservations.deleted_at", "is", null)
					.where("reservations.expires_at", ">", now)
					.execute();
				await restore({
					buyers: purchases.map((row) => row.username),
					holds: holds.map((row) => ({
						user: row.username,
						reservationId: row.id,
						expiresAt: row.expires_at,
					})),
				});
			});
		},
	};
}
