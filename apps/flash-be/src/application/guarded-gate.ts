// The hold gate with a memory of trouble (application layer). When a call to Redis fails, or its answer cannot be read,
// Postgres may have decided something Redis did not see: a hold taken without it, or a purchase it was not told about.
// Such a sale is marked stale, and the next reservation on it first rebuilds Redis from Postgres. This is the choice of
// decision 003 (selling without Redis).
import { attemptAsync } from "@flash/typekit";
import type { HoldGate } from "./ports/hold-gate.js";

// The gate, plus the means to mark a sale stale when a write elsewhere failed.
export type GuardedGate = HoldGate & { markStale: (saleId: string) => void };

// Wraps the Redis gate. A failed call re-throws, so the caller can fall back to Postgres; an unreadable answer is passed
// on as a failure value, and the sale is marked stale either way.
export function createGuardedGate(inner: HoldGate): GuardedGate {
	const stale = new Set<string>();
	// If the invalidation fails, the sale stays stale and the next call tries again.
	const catchUp = async (saleId: string): Promise<void> => {
		if (!stale.has(saleId)) return;
		await inner.invalidate(saleId);
		stale.delete(saleId);
	};
	// A failed call leaves Redis behind Postgres, so the sale is marked stale before the failure goes on.
	const marking = async <T>(
		saleId: string,
		call: () => Promise<T>,
	): Promise<T> => {
		const outcome = await attemptAsync(call, Error);
		if (outcome.isErr()) {
			stale.add(saleId);
			throw outcome.error;
		}
		return outcome.value;
	};

	return {
		...inner,
		markStale: (saleId) => {
			stale.add(saleId);
		},
		reserve: async (request) => {
			const answer = await marking(request.saleId, async () => {
				await catchUp(request.saleId);
				return inner.reserve(request);
			});
			if (answer.isErr()) stale.add(request.saleId);
			return answer;
		},
		release: (saleId, user) =>
			marking(saleId, () => inner.release(saleId, user)),
		confirm: (saleId, user) =>
			marking(saleId, () => inner.confirm(saleId, user)),
	};
}
