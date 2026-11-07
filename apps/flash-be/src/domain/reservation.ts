// A hold: one shopper's claim on one item of a sale, and the answers the fast gate and the source of truth give when
// asked for one. The rules here are the shapes; the sale and the store decide which answer comes back.
import type { Sale } from "./sale.js";
import { MS_PER_SECOND } from "./time.js";
import type { Username } from "./user.js";

// The hold one shopper has on one item of a sale.
export type Reservation = {
	saleId: string;
	user: Username;
	reservationId: string;
	expiresAt: Date;
};

// Everything needed to decide one reservation.
export type ReserveRequest = {
	saleId: string;
	user: Username;
	reservationId: string;
	now: Date;
	expiresAt: Date;
	stock: number;
};

// The answer of the fast gate to one reserve request.
export type GateAnswer =
	// A new hold was written.
	| { kind: "reserved"; reservationId: string; expiresAt: Date }
	// The user already holds an item: the same answer comes back, so a retry is safe.
	| { kind: "held"; reservationId: string; expiresAt: Date }
	// The user already bought in this sale, so they may not hold again.
	| { kind: "purchased" }
	| { kind: "sold_out" }
	// The fast store has no reservation state for this sale (it was lost or never built). Rebuild it from the
	// source of truth.
	| { kind: "not_ready" };

// The answer when the fast store is down and the source of truth decides alone. `redis_ready` means the fast store
// is ready again, so the caller should use the gate instead.
export type FallbackAnswer = GateAnswer | { kind: "redis_ready" };

// The state a rebuild copies into the fast store: who bought, and who holds an item right now.
export type HoldSnapshot = {
	buyers: Username[];
	holds: Array<{ user: Username; reservationId: string; expiresAt: Date }>;
};

// What a shopper asks for when they reserve: one item, held for the time the sale sets.
export function holdRequest(
	sale: Sale,
	user: Username,
	reservationId: string,
	now: Date,
): ReserveRequest {
	return {
		saleId: sale.id,
		user,
		reservationId,
		now,
		expiresAt: new Date(now.getTime() + sale.holdSeconds * MS_PER_SECOND),
		stock: sale.stock,
	};
}
