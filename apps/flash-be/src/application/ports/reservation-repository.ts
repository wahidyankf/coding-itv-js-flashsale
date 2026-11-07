// Holds in Postgres, the source of truth. The gate decides fast; this repository keeps the copy that a rebuild reads,
// and it decides alone when the gate is down. Application layer, port: an adapter implements it, and the services use it
// without knowing which store it is.
import type {
	FallbackAnswer,
	HoldSnapshot,
	Reservation,
	ReserveRequest,
} from "../../domain/reservation.js";
import type { Username } from "../../domain/user.js";

// The Postgres side of the holds, behind a port, so the reserve service runs the same over a database or a double.
export type ReservationRepository = {
	// True when the shopper already bought in this sale. Asked only when the queue has no place for them.
	hasPurchase(saleId: string, user: Username): Promise<boolean>;
	// Writes the hold. One row per shopper and sale: a new hold replaces an expired one.
	save(reservation: Reservation): Promise<void>;
	// Decides a reservation when the gate is down. The name says which store it does without: the docs call this
	// "serving without Redis", and the name keeps that case visible at the call site. It reads the state the decision
	// needs under the sale's row lock, and the decision is the domain's (`decideReservation`). `gateReady` is asked under
	// that same lock, so a rebuild cannot slip in between: if the gate is ready again, nothing is written and the caller
	// uses the gate.
	reserveWithoutGate(
		request: ReserveRequest,
		gateReady: () => Promise<boolean>,
	): Promise<FallbackAnswer>;
	// Hands the sale's purchases and live holds to `restore` while the sale row is locked, so no reservation can slip in
	// between the snapshot and the moment the gate is marked ready.
	rebuild(
		saleId: string,
		now: Date,
		restore: (snapshot: HoldSnapshot) => Promise<void>,
	): Promise<void>;
};
