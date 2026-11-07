// The reservation hold gate in memory for the unit layer (test support). Its answers and its counting follow the Redis
// script, so one scenario gives the same reply in both layers. Its answers come back as Results, as the Redis gate's do.
import { Ok } from "@flash/typekit";
import type { Clock } from "../../application/ports/clock.js";
import type { HoldGate } from "../../application/ports/hold-gate.js";
import type { GateAnswer, ReserveRequest } from "../../domain/reservation.js";
import { hasRoom } from "../../domain/sale.js";

type SaleState = {
	ready: boolean;
	buyers: Set<string>;
	holds: Map<string, { reservationId: string; expiresAt: number }>;
};

// The hold gate of the unit layer, with a way to forget a sale's state, as a rebuild after a restart would.
export type MemoryHoldGate = HoldGate & { forget: (saleId: string) => void };

// The reservation state in memory, for unit tests. It follows the same rules as the Redis script.
export function memoryHoldGate(clock: Clock): MemoryHoldGate {
	const sales = new Map<string, SaleState>();
	// The rebuild lock of each sale: when it ends, and whose it is, as the Redis lock keeps them.
	const locks = new Map<string, { until: number; owner: string }>();
	const stateOf = (saleId: string): SaleState => {
		let state = sales.get(saleId);
		if (!state) {
			state = { ready: false, buyers: new Set(), holds: new Map() };
			sales.set(saleId, state);
		}
		return state;
	};

	// The answer of the Redis script to one reserve request, in the same order of checks.
	const answerOf = (request: ReserveRequest): GateAnswer => {
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
	};

	return {
		forget: (saleId) => {
			sales.delete(saleId);
		},

		async reserve(request) {
			return new Ok(answerOf(request));
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

		async lockRebuild(saleId, ms, owner) {
			const now = clock().getTime();
			const held = locks.get(saleId);
			if (held !== undefined && held.until > now) return false;
			locks.set(saleId, { until: now + ms, owner });
			return true;
		},

		// Only the owner's lock is released, as the compare-and-delete script does.
		async unlockRebuild(saleId, owner) {
			if (locks.get(saleId)?.owner === owner) locks.delete(saleId);
		},
	};
}
