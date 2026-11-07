// The gate: the fast, shared answer to "who holds or bought an item of this sale". Redis implements it. Postgres stays
// the source of truth: when the gate loses its state, a rebuild copies Postgres back into it.
import type {
	GateAnswer,
	HoldSnapshot,
	ReserveRequest,
} from "../../domain/reservation.js";
import type { Username } from "../../domain/user.js";

export type HoldGate = {
	// Asks for a hold. The gate decides the stock and the one hold per shopper in one step, so two requests cannot both
	// take the last item.
	reserve(request: ReserveRequest): Promise<GateAnswer>;
	// Gives a hold back, for example when it could not be written to Postgres.
	release(saleId: string, user: Username): Promise<void>;
	// Records a purchase: the shopper becomes a buyer and the hold goes away.
	confirm(saleId: string, user: Username): Promise<void>;
	// Whether the gate holds this sale's state. When it does not, the next reservation rebuilds it.
	isReady(saleId: string): Promise<boolean>;
	// Marks the state as not ready, so the next reservation rebuilds it from Postgres.
	invalidate(saleId: string): Promise<void>;
	// Replaces the state with the snapshot from Postgres, then marks it ready.
	restore(saleId: string, snapshot: HoldSnapshot): Promise<void>;
	// Only one instance rebuilds a sale at a time. True when this caller may rebuild, for `ms`. The lock expires by itself,
	// so an instance that dies while it holds the lock does not block the sale.
	lockRebuild(saleId: string, ms: number): Promise<boolean>;
	unlockRebuild(saleId: string): Promise<void>;
};
