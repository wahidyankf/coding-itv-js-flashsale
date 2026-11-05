import { randomUUID } from "node:crypto";
import {
	type GateAnswer,
	holdRequest,
	type ReserveRequest,
} from "../domain/reservation.js";
import { reserveBlock } from "../domain/sale.js";
import { normalizeUser } from "../domain/user.js";
import type { GuardedGate } from "./guarded-gate.js";
import type { Clock } from "./ports/clock.js";
import type { ReservationRepository } from "./ports/reservation-repository.js";
import type { QueueService } from "./queue-service.js";
import type { SaleService } from "./sale-service.js";

export type ReserveError =
	| "sale_not_found"
	| "invalid_user"
	| "invalid_ticket"
	| "not_admitted"
	| "sale_not_started"
	| "sale_ended"
	| "sold_out"
	| "already_purchased"
	| "unavailable";

export type ReserveResult =
	| {
			ok: true;
			created: boolean;
			user: string;
			reservationId: string;
			expiresAt: Date;
	  }
	| { ok: false; error: ReserveError };

export type ReservationOptions = {
	// How long to wait for another instance that is rebuilding the sale's reservation state.
	rebuildWaitMs: number;
	wait: (ms: number) => Promise<void>;
};

export const defaultReservationOptions: ReservationOptions = {
	rebuildWaitMs: 3000,
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const REBUILD_LOCK_MS = 10_000;
const POLL_MS = 25;

export type ReservationService = ReturnType<typeof createReservationService>;

export function createReservationService(
	gate: GuardedGate,
	repository: ReservationRepository,
	sales: SaleService,
	queue: QueueService,
	clock: Clock,
	options: ReservationOptions = defaultReservationOptions,
) {
	// Rebuilds the sale's reservation state in Redis from Postgres. One instance does it; the others wait for it.
	async function ensureReady(saleId: string): Promise<boolean> {
		if (await gate.isReady(saleId)) return true;
		if (await gate.lockRebuild(saleId, REBUILD_LOCK_MS)) {
			try {
				await repository.rebuild(saleId, clock(), (snapshot) =>
					gate.restore(saleId, snapshot),
				);
			} finally {
				await gate.unlockRebuild(saleId);
			}
			return true;
		}
		for (let waited = 0; waited < options.rebuildWaitMs; waited += POLL_MS) {
			await options.wait(POLL_MS);
			if (await gate.isReady(saleId)) return true;
		}
		return false;
	}

	// The fast path: ask the gate, and rebuild its state first when it has none.
	async function viaGate(request: ReserveRequest): Promise<GateAnswer> {
		const answer = await gate.reserve(request);
		if (answer.kind !== "not_ready") return answer;
		if (!(await ensureReady(request.saleId))) return { kind: "not_ready" };
		return gate.reserve(request);
	}

	return {
		async reserve(
			saleId: string,
			rawUser: unknown,
			ticket: string | undefined,
		): Promise<ReserveResult> {
			const found = await sales.details(saleId);
			if (!found) return { ok: false, error: "sale_not_found" };

			if (!normalizeUser(rawUser)) return { ok: false, error: "invalid_user" };

			// A sale that is not selling answers first, so a shopper learns it without a valid ticket.
			const { sale, view } = found;
			const blocked = reserveBlock(view.status);
			if (blocked) return { ok: false, error: blocked };

			const entry = await queue.check(saleId, rawUser, ticket);
			if (!entry.ok) {
				if (entry.error === "not_in_queue") {
					// The queue is only in Redis and can be lost. A shopper who already bought is told so, not sent back.
					const user = normalizeUser(rawUser);
					const bought = user && (await repository.hasPurchase(saleId, user));
					return {
						ok: false,
						error: bought ? "already_purchased" : "not_admitted",
					};
				}
				return { ok: false, error: entry.error };
			}
			if (entry.place.state !== "admitted") {
				return { ok: false, error: "not_admitted" };
			}

			const request = holdRequest(sale, entry.user, randomUUID(), clock());

			// Redis decides when it can. When it fails, Postgres decides alone under the sale row lock, which is
			// slower but keeps the stock and the one-per-user rule. That path writes the hold itself.
			let answer: GateAnswer;
			let written = false;
			try {
				answer = await viaGate(request);
			} catch {
				gate.markStale(saleId);
				const fallback = await repository.reserveWithoutRedis(request, () =>
					gate.isReady(saleId),
				);
				if (fallback.kind === "redis_ready") {
					answer = await viaGate(request);
				} else {
					answer = fallback;
					written = true;
				}
			}

			switch (answer.kind) {
				case "reserved":
					if (written) {
						return { ok: true, created: true, user: entry.user, ...answer };
					}
					try {
						await repository.save({
							saleId,
							user: entry.user,
							reservationId: answer.reservationId,
							expiresAt: answer.expiresAt,
						});
					} catch (error) {
						// Without its Postgres row a hold could not be rebuilt, so the item goes back.
						await gate.release(saleId, entry.user);
						throw error;
					}
					return { ok: true, created: true, user: entry.user, ...answer };
				case "held":
					return { ok: true, created: false, user: entry.user, ...answer };
				case "purchased":
					return { ok: false, error: "already_purchased" };
				case "sold_out":
					return { ok: false, error: "sold_out" };
				case "not_ready":
					return { ok: false, error: "unavailable" };
			}
		},
	};
}
