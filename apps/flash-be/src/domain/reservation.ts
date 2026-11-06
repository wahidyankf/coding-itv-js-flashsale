import type { Sale } from "./sale.js";
import { MS_PER_SECOND } from "./time.js";

// The hold one user has on one item of a sale.
export type Reservation = {
	saleId: string;
	user: string;
	reservationId: string;
	expiresAt: Date;
};

// Everything needed to decide one reservation.
export type ReserveRequest = {
	saleId: string;
	user: string;
	reservationId: string;
	now: Date;
	expiresAt: Date;
	stock: number;
};

export type GateAnswer =
	| { kind: "reserved"; reservationId: string; expiresAt: Date }
	// The user already holds an item: the same answer comes back, so a retry is safe.
	| { kind: "held"; reservationId: string; expiresAt: Date }
	| { kind: "purchased" }
	| { kind: "sold_out" }
	// The fast store has no reservation state for this sale (it was lost or never built). Rebuild it from the
	// source of truth.
	| { kind: "not_ready" };

// The answer when the fast store is down and the source of truth decides alone. `redis_ready` means the fast store
// is ready again, so the caller should use the gate instead.
export type FallbackAnswer = GateAnswer | { kind: "redis_ready" };

export type HoldSnapshot = {
	buyers: string[];
	holds: Array<{ user: string; reservationId: string; expiresAt: Date }>;
};

// A hold counts while its end time has not passed. An old one frees the item without any job to clear it.
export function isLive(reservation: { expiresAt: Date }, now: Date): boolean {
	return reservation.expiresAt > now;
}

// What a shopper asks for when they reserve: one item, held for the time the sale sets.
export function holdRequest(
	sale: Sale,
	user: string,
	reservationId: string,
	now: Date,
): ReserveRequest {
	return {
		saleId: sale.id,
		user,
		reservationId,
		now,
		expiresAt: new Date(
			now.getTime() + sale.reservationTtlSeconds * MS_PER_SECOND,
		),
		stock: sale.stock,
	};
}
