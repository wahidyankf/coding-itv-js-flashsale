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
