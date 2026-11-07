// The reservation hold gate in memory for the unit layer. Its answers and its counting follow the Redis script, so one
// scenario gives the same reply in both layers.
import type { Clock } from "../../application/ports/clock.js";
import type { HoldGate } from "../../application/ports/hold-gate.js";
import type { GateAnswer } from "../../domain/reservation.js";
import { hasRoom } from "../../domain/sale.js";

type SaleState = {
	ready: boolean;
	buyers: Set<string>;
	holds: Map<string, { reservationId: string; expiresAt: number }>;
};

export type MemoryHoldGate = HoldGate & { forget: (saleId: string) => void };

// The reservation state in memory, for unit tests. It follows the same rules as the Redis script.
export function memoryHoldGate(clock: Clock): MemoryHoldGate {
	const sales = new Map<string, SaleState>();
	const locks = new Map<string, number>();
	const stateOf = (saleId: string): SaleState => {
		let state = sales.get(saleId);
		if (!state) {
			state = { ready: false, buyers: new Set(), holds: new Map() };
			sales.set(saleId, state);
		}
		return state;
	};

	return {
		forget: (saleId) => {
			sales.delete(saleId);
		},

		async reserve(request): Promise<GateAnswer> {
			const state = stateOf(request.saleId);
			if (!state.ready) return { kind: "not_ready" };
			if (state.buyers.has(request.user)) return { kind: "purchased" };
			const now = request.now.getTime();
			const own = state.holds.get(request.user);
			if (own && own.expiresAt > now) {
				return {
					kind: "held",
					reservationId: own.reservationId,
					expiresAt: new Date(own.expiresAt),
				};
			}
			// Inclusive, as the Redis script counts holds from now on, so a hold ending this very millisecond still counts.
			const live = [...state.holds.values()].filter(
				(hold) => hold.expiresAt >= now,
			).length;
			if (!hasRoom(state.buyers.size, live, request.stock)) {
				return { kind: "sold_out" };
			}
			state.holds.set(request.user, {
				reservationId: request.reservationId,
				expiresAt: request.expiresAt.getTime(),
			});
			return {
				kind: "reserved",
				reservationId: request.reservationId,
				expiresAt: request.expiresAt,
			};
		},

		async release(saleId, user) {
			stateOf(saleId).holds.delete(user);
		},

		async confirm(saleId, user) {
			const state = stateOf(saleId);
			state.buyers.add(user);
			state.holds.delete(user);
		},

		async isReady(saleId) {
			return stateOf(saleId).ready;
		},

		async invalidate(saleId) {
			stateOf(saleId).ready = false;
		},

		async restore(saleId, snapshot) {
			const state = stateOf(saleId);
			state.buyers = new Set(snapshot.buyers);
			state.holds = new Map(
				snapshot.holds.map((hold) => [
					hold.user,
					{
						reservationId: hold.reservationId,
						expiresAt: hold.expiresAt.getTime(),
					},
				]),
			);
			state.ready = true;
		},

		async lockRebuild(saleId, ms) {
			const now = clock().getTime();
			if ((locks.get(saleId) ?? 0) > now) return false;
			locks.set(saleId, now + ms);
			return true;
		},

		async unlockRebuild(saleId) {
			locks.delete(saleId);
		},
	};
}
