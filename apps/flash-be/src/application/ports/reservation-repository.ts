// Holds in Postgres, the source of truth. The gate decides fast; this repository keeps the copy that a rebuild reads,
// and it decides alone when the gate is down.
import type {
	FallbackAnswer,
	HoldSnapshot,
	Reservation,
	ReserveRequest,
} from "../../domain/reservation.js";
import type { Username } from "../../domain/user.js";

export type ReservationRepository = {
	// True when the shopper already bought in this sale. Asked only when the queue has no place for them.
	hasPurchase(saleId: string, user: Username): Promise<boolean>;
	// Writes the hold. One row per shopper and sale: a new hold replaces an expired one.
	save(reservation: Reservation): Promise<void>;
	// Decides a reservation when the gate is down. The name says which store it does without: the docs call this
	// "serving without Redis", and the name keeps that case visible at the call site. It counts the items sold and the live
	// holds of the others under the sale's row lock. `redisReady` is asked under that same lock, so a rebuild cannot
	// slip in between: if the gate is ready again, nothing is written and the caller uses the gate.
	reserveWithoutRedis(
		request: ReserveRequest,
		redisReady: () => Promise<boolean>,
	): Promise<FallbackAnswer>;
	// Hands the sale's purchases and live holds to `restore` while the sale row is locked, so no reservation can slip in
	// between the snapshot and the moment the gate is marked ready.
	rebuild(
		saleId: string,
		now: Date,
		restore: (snapshot: HoldSnapshot) => Promise<void>,
	): Promise<void>;
};
