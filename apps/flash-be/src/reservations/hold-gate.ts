// Everything the gate needs to decide one reservation.
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
	// Redis has no reservation state for this sale (it was lost or never built). Rebuild it from Postgres.
	| { kind: "not_ready" };

export type HoldSnapshot = {
	buyers: string[];
	holds: Array<{ user: string; reservationId: string; expiresAt: Date }>;
};

// The fast, shared view of who holds or bought an item. Redis implements it. Postgres stays the source of truth.
export type HoldGate = {
	reserve(request: ReserveRequest): Promise<GateAnswer>;
	// Gives a hold back, for example when it could not be written to Postgres.
	release(saleId: string, user: string): Promise<void>;
	isReady(saleId: string): Promise<boolean>;
	// Replaces the sale's reservation state with the snapshot, then marks it ready.
	restore(saleId: string, snapshot: HoldSnapshot): Promise<void>;
	// One instance rebuilds at a time. True when this caller may rebuild, for `ms`.
	lockRebuild(saleId: string, ms: number): Promise<boolean>;
	unlockRebuild(saleId: string): Promise<void>;
};
