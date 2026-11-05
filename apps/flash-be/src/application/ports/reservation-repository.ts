import type {
	FallbackAnswer,
	HoldSnapshot,
	Reservation,
	ReserveRequest,
} from "../../domain/reservation.js";

// Reservations are written to the source of truth next to the fast gate. The gate decides fast; this copy is what a
// rebuild reads.
export type ReservationRepository = {
	// True when the user already bought in this sale. Asked only when the queue has no place for them.
	hasPurchase(saleId: string, user: string): Promise<boolean>;
	// One row per user and sale. A new hold replaces an expired one.
	save(reservation: Reservation): Promise<void>;
	// The reservation when the gate is down: the store counts the sold items and the live holds under the sale row
	// lock. `redisReady` is asked under that lock; if the gate is ready again, nothing is written and the caller uses
	// the gate.
	reserveWithoutRedis(
		request: ReserveRequest,
		redisReady: () => Promise<boolean>,
	): Promise<FallbackAnswer>;
	// Runs `restore` with the sale's purchases and live holds while the sale row is locked, so no reservation
	// can slip in between the snapshot and the moment the gate is marked ready.
	rebuild(
		saleId: string,
		now: Date,
		restore: (snapshot: HoldSnapshot) => Promise<void>,
	): Promise<void>;
};
