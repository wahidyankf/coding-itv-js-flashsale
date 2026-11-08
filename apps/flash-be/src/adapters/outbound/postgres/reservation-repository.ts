// Holds in Postgres, the source of truth for who holds an item. The Redis gate decides fast; this repository keeps the copy
// that a rebuild reads, and it decides alone when Redis is down (decision 003). Outbound Postgres adapter for the
// ReservationRepository port.
import { attemptAsync } from "@flash/typekit";
import type { Kysely } from "kysely";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";
import {
	earlyReservationAnswer,
	type FallbackAnswer,
	type HoldSnapshot,
	holdWriteOf,
	type Reservation,
	type ReserveRequest,
	roomReservationAnswer,
	type ShopperState,
} from "../../../domain/reservation.js";
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

// The hold of one shopper in one sale, as the writes below take it.
type HoldInput = {
	id: string;
	saleId: string;
	userId: string;
	expiresAt: Date;
};

// Locks what a write of the shopper's hold depends on, always in the same order: the sale row (shared, so shoppers do not
// wait for each other), then the shopper's row (exclusive, so two writes of one shopper's hold run one at a time). The
// Postgres fallback takes the sale row first too, so the two paths can never wait on each other in a circle. Returns the
// id of the shopper's live row in the sale, if there is one.
async function lockShopperHold(
	trx: Kysely<Database>,
	hold: HoldInput,
): Promise<string | undefined> {
	await trx
		.selectFrom("sales")
		.select("id")
		.where("id", "=", hold.saleId)
		.forKeyShare()
		.execute();
	const row = await trx
		.selectFrom("users")
		.leftJoin("reservations", (join) =>
			join
				.onRef("reservations.user_id", "=", "users.id")
				.on("reservations.sale_id", "=", hold.saleId)
				.on(live("reservations")),
		)
		.select("reservations.id")
		.where("users.id", "=", hold.userId)
		.forNoKeyUpdate("users")
		.executeTakeFirst();
	return row?.id ?? undefined;
}

// The same hold again: its row stays, with its new end, and records who renewed it.
async function renewHold(
	trx: Kysely<Database>,
	hold: HoldInput,
): Promise<void> {
	await trx
		.updateTable("reservations")
		.set({
			expires_at: hold.expiresAt,
			updated_at: dbNow,
			updated_by: hold.userId,
		})
		.where("id", "=", hold.id)
		.execute();
}

// Another hold takes the place of the shopper's live row, which stays as a row marked deleted by the shopper.
async function retireLiveHold(
	trx: Kysely<Database>,
	hold: HoldInput,
): Promise<void> {
	await trx
		.updateTable("reservations")
		.set({ deleted_at: dbNow, deleted_by: hold.userId })
		.where("sale_id", "=", hold.saleId)
		.where("user_id", "=", hold.userId)
		.where(live("reservations"))
		.execute();
}

// A new row for a new hold. The shopper is its author.
async function insertHold(
	trx: Kysely<Database>,
	hold: HoldInput,
): Promise<void> {
	await trx
		.insertInto("reservations")
		.values({
			id: hold.id,
			sale_id: hold.saleId,
			user_id: hold.userId,
			expires_at: hold.expiresAt,
			created_by: hold.userId,
		})
		.execute();
}

// Writes the hold as the shopper's one live row in the sale, by the domain's rule (`holdWriteOf`). A row is never
// overwritten by another hold, so an expired hold the shopper takes again is kept, marked deleted. The caller runs it in
// a transaction, so the old row and the new one change together.
async function writeHold(
	trx: Kysely<Database>,
	hold: HoldInput,
): Promise<void> {
	const liveId = await lockShopperHold(trx, hold);
	switch (holdWriteOf(liveId, hold.id)) {
		case "renew":
			await renewHold(trx, hold);
			return;
		case "replace":
			await retireLiveHold(trx, hold);
			await insertHold(trx, hold);
			return;
		case "insert":
			await insertHold(trx, hold);
			return;
	}
}

// Writes the hold a reservation asks for, as the shopper's one live hold in the sale, in one transaction.
async function saveHold(
	db: Kysely<Database>,
	reservation: Reservation,
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		const userId = await ensureUser(trx, reservation.user);
		await writeHold(trx, {
			id: reservation.reservationId,
			saleId: reservation.saleId,
			userId,
			expiresAt: reservation.expiresAt,
		});
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
		.where(live("reservations"))
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
	const holders = await trx
		.selectFrom("reservations")
		.select((builder) => builder.fn.countAll<string>().as("count"))
		.where("sale_id", "=", saleId)
		.where(live("reservations"))
		.where("expires_at", ">", now)
		.where("user_id", "!=", userId)
		.executeTakeFirstOrThrow();
	return Number(holders.count);
}

// What the early answers need about the shopper, read in their order: the purchase first, then the own hold. A buyer's own
// hold is not read, because the purchase answers before it does.
async function shopperStateOf(
	trx: Kysely<Database>,
	request: ReserveRequest,
	userId: string,
): Promise<ShopperState> {
	const purchased =
		(await livePurchaseOf(trx, request.saleId, request.user)) !== undefined;
	if (purchased) return { purchased, ownHold: undefined };
	const own = await ownHoldOf(trx, request.saleId, userId);
	return {
		purchased,
		ownHold: own
			? { reservationId: own.id, expiresAt: own.expires_at }
			: undefined,
	};
}

// The Postgres fallback, under the sale's row lock. The order of the steps is the rule: lock, rebuild check, purchase and
// own hold, then the count of the others, then the write. A removed sale answers `sale_not_found` as a value, not a
// failure.
async function reserveUnderLock(
	trx: Kysely<Database>,
	request: ReserveRequest,
	gateReady: () => Promise<boolean>,
): Promise<FallbackAnswer> {
	// The sale row lock. The rebuild takes the same lock, so after it Redis is ready and holds everything written so far.
	const sale = await lockLiveSale(trx, request.saleId);
	if (sale === undefined) return { kind: "sale_not_found" };
	const ready = await attemptAsync(gateReady, Error);
	if (ready.isOk() && ready.value) return { kind: "gate_ready" };

	const userId = await ensureUser(trx, request.user);
	// The purchase and the own hold often answer without counting the other holds.
	const early = earlyReservationAnswer(
		await shopperStateOf(trx, request, userId),
		request,
	);
	if (early !== undefined) return early;

	const decision = roomReservationAnswer(
		{
			sold: sale.sold,
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
		await writeHold(trx, {
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
		buyers: purchases.map((row) => storedUsername(row.username)),
		holds: holds.map((row) => ({
			user: storedUsername(row.username),
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
				await lockLiveSale(trx, saleId);
				await restore(await snapshotOf(trx, saleId, now));
			}),
	};
}
