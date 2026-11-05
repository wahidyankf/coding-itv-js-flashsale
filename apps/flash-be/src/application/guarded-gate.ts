import { attemptAsync } from "@flash/typekit";
import type { HoldGate } from "./ports/hold-gate.js";

// A gate that remembers which sales Redis may have fallen behind on. When a call fails, Postgres may have decided
// something that Redis did not see (a hold taken without it, a purchase it was not told about). The next
// reservation on that sale marks the Redis state as not ready, which makes one instance rebuild it from Postgres.
export type GuardedGate = HoldGate & { markStale: (saleId: string) => void };

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
		reserve: (request) =>
			marking(request.saleId, async () => {
				await catchUp(request.saleId);
				return inner.reserve(request);
			}),
		release: (saleId, user) =>
			marking(saleId, () => inner.release(saleId, user)),
		confirm: (saleId, user) =>
			marking(saleId, () => inner.confirm(saleId, user)),
	};
}
