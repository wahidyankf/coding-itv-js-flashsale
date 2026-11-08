// Kind: repository (a record kept in Postgres, which survives a Redis outage). Holds in Postgres, the source of truth.
// The gate decides fast; this repository keeps the copy a rebuild reads, and decides alone when the gate is down.
// Application layer, port: an adapter implements it, and the services use it without knowing which store it is.
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
	// Writes the hold. A shopper has one live row per sale: the same hold renews it, and a new hold (after an expired one)
	// gets a row of its own while the old row stays, marked deleted by the shopper, so no hold is ever lost. A sale that
	// was removed gets no hold, because its holds went with it.
	save(reservation: Reservation): Promise<void>;
	// Decides a reservation when the gate is down, under the sale's row lock. `gateReady` is asked under that same lock, so
	// a rebuild cannot slip in between; if the gate is ready, nothing is written. The rule is `decideReservation` in the
	// domain. The name says Redis is skipped; the docs call this "serving without Redis".
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
