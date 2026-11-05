import type {
	GateAnswer,
	HoldSnapshot,
	ReserveRequest,
} from "../../domain/reservation.js";

// The fast, shared view of who holds or bought an item. Redis implements it. Postgres stays the source of truth.
export type HoldGate = {
	reserve(request: ReserveRequest): Promise<GateAnswer>;
	// Gives a hold back, for example when it could not be written to Postgres.
	release(saleId: string, user: string): Promise<void>;
	// A purchase is done: the user becomes a buyer and their hold goes away.
	confirm(saleId: string, user: string): Promise<void>;
	isReady(saleId: string): Promise<boolean>;
	// Marks the sale's reservation state as not ready, so the next reservation rebuilds it from Postgres.
	invalidate(saleId: string): Promise<void>;
	// Replaces the sale's reservation state with the snapshot, then marks it ready.
	restore(saleId: string, snapshot: HoldSnapshot): Promise<void>;
	// One instance rebuilds at a time. True when this caller may rebuild, for `ms`.
	lockRebuild(saleId: string, ms: number): Promise<boolean>;
	unlockRebuild(saleId: string): Promise<void>;
};
