// Kind: gate (the fast check that answers before Postgres is asked). Application layer, port.
import type { Result } from "@flash/typekit";
import type {
	GateAnswer,
	HoldSnapshot,
	ReserveRequest,
} from "../../domain/reservation.js";
import type { Username } from "../../domain/user.js";
import type { UnreadableReply } from "./reply.js";

// The fast state behind a port: Redis in production, a memory double in tests. Postgres stays the last word on the stock.
// When the gate loses its state, a rebuild copies Postgres back into it.
export type HoldGate = {
	// Asks for a hold. The gate decides the stock and the one hold per shopper in one step, so two requests cannot both
	// take the last item. An answer that cannot be read is a failure value, never a guess.
	reserve(
		request: ReserveRequest,
	): Promise<Result<GateAnswer, UnreadableReply>>;
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
	// Only one instance rebuilds a sale at a time. Returns true when this caller got the lock for `ms`, under `owner`.
	// The lock expires by itself, so an instance that dies while holding it does not block the sale.
	lockRebuild(saleId: string, ms: number, owner: string): Promise<boolean>;
	// Releases the lock only when `owner` still holds it. A rebuild that ran past its lock time must not free the lock of
	// the instance that took over.
	unlockRebuild(saleId: string, owner: string): Promise<void>;
};
