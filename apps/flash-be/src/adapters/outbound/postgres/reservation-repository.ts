// Holds in Postgres, the source of truth for who holds an item. The Redis gate decides fast; this repository keeps the copy
// that a rebuild reads, and it decides alone when Redis is down (decision 003). Outbound Postgres adapter for the
// ReservationRepository port.
import { attemptAsync } from "@flash/typekit";
import { type Kysely, sql } from "kysely";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";
import {
	decideReservation,
	type FallbackAnswer,
	type HoldSnapshot,
	type Reservation,
	type ReserveRequest,
} from "../../../domain/reservation.js";
import type { Database } from "./database.js";
import {
	livePurchaseOf,
	lockSaleRow,
	purchasesWithBuyer,
	reservationsWithUser,
} from "./queries.js";
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

// Writes the hold a reservation asks for, as the shopper's one live hold in the sale.
async function saveHold(
	db: Kysely<Database>,
	reservation: Reservation,
): Promise<void> {
	const userId = await ensureUser(db, reservation.user);
	await upsertHold(db, {
		id: reservation.reservationId,
		saleId: reservation.saleId,
		userId,
		expiresAt: reservation.expiresAt,
	});
}

// The shopper's own hold in the sale, live or not. The domain decides whether it is still live.
async function ownHoldOf(
	trx: Kysely<Database>,
	saleId: string,
	userId: string,
) {
	return trx
		.selectFrom("reservations")
		.select(["id", "expires_at"])
		.where("sale_id", "=", saleId)
		.where("user_id", "=", userId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

// How many shoppers other than this one hold an item now. A hold counts while `expires_at > now`, which is the domain's
// rule (`isLive`). Redis counts a hold that expires exactly now as still live (`>=`). The two differ by one millisecond,
// and the difference errs on the safe side: Redis may refuse, but it never oversells. Neither side is changed for it.
async function countHoldsOfOthers(
	trx: Kysely<Database>,
	saleId: string,
	userId: string,
	now: Date,
): Promise<number> {
	const live = await trx
		.selectFrom("reservations")
		.select((builder) => builder.fn.countAll<string>().as("count"))
		.where("sale_id", "=", saleId)
		.where("deleted_at", "is", null)
		.where("expires_at", ">", now)
		.where("user_id", "!=", userId)
		.executeTakeFirstOrThrow();
	return Number(live.count);
}

// The Postgres fallback, under the sale's row lock. The steps run in this order, and the order is the rule: the lock
// first, then the rebuild check, then the state the decision needs, then the decision, and only then the write. A sale
// that is gone answers `sale_not_found`, so a removal during a request is a value, not a failure.
async function reserveUnderLock(
	trx: Kysely<Database>,
	request: ReserveRequest,
	gateReady: () => Promise<boolean>,
): Promise<FallbackAnswer> {
	// The sale row lock. The rebuild takes the same lock, so after it Redis is ready and holds everything written so far.
	const sale = await trx
		.selectFrom("sales")
		.select("sold")
		.where("id", "=", request.saleId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (sale === undefined) return { kind: "sale_not_found" };
	const ready = await attemptAsync(gateReady, Error);
	if (ready.isOk() && ready.value) return { kind: "gate_ready" };

	const userId = await ensureUser(trx, request.user);
	const own = await ownHoldOf(trx, request.saleId, userId);
	const decision = decideReservation(
		{
			sold: sale.sold,
			purchased:
				(await livePurchaseOf(trx, request.saleId, request.user)) !== undefined,
			ownHold: own
				? { reservationId: own.id, expiresAt: own.expires_at }
				: undefined,
			othersHolding: await countHoldsOfOthers(
				trx,
				request.saleId,
				userId,
				request.now,
			),
		},
		request,
	);
	if (decision.kind === "reserved") {
		await upsertHold(trx, {
			id: request.reservationId,
			saleId: request.saleId,
			userId,
			expiresAt: request.expiresAt,
		});
	}
	return decision;
}

// The buyers and the live holds of a sale, read for a rebuild of Redis. The caller holds the sale lock.
async function snapshotOf(
	trx: Kysely<Database>,
	saleId: string,
	now: Date,
): Promise<HoldSnapshot> {
	const purchases = await purchasesWithBuyer(trx)
		.where("purchases.sale_id", "=", saleId)
		.execute();
	const holds = await reservationsWithUser(trx)
		.where("reservations.sale_id", "=", saleId)
		.where("reservations.expires_at", ">", now)
		.execute();
	return {
		buyers: purchases.map((row) => row.username),
		holds: holds.map((row) => ({
			user: row.username,
			reservationId: row.id,
			expiresAt: row.expires_at,
		})),
	};
}

// The repository over Postgres for holds. `rebuild` hands the snapshot to `restore` inside the same locked transaction,
// so no hold can be written between the read and the restore.
export function createReservationRepository(
	db: Kysely<Database>,
): ReservationRepository {
	return {
		// True when the shopper already bought in this sale. The purchase row is the proof, not the hold.
		hasPurchase: async (saleId, user) =>
			(await livePurchaseOf(db, saleId, user)) !== undefined,

		save: (reservation) => saveHold(db, reservation),

		reserveWithoutGate: (request, gateReady) =>
			db
				.transaction()
				.execute((trx) => reserveUnderLock(trx, request, gateReady)),

		rebuild: (saleId, now, restore) =>
			db.transaction().execute(async (trx) => {
				await lockSaleRow(trx, saleId);
				await restore(await snapshotOf(trx, saleId, now));
			}),
	};
}
