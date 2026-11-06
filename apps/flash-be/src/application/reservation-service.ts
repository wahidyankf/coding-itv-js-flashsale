import { randomUUID } from "node:crypto";
import type { RESERVE_ERRORS } from "@flash/contract/vocabulary";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
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
import type { SaleDetails, SaleService } from "./sale-service.js";

export type ReserveError = (typeof RESERVE_ERRORS)[number];

export type Reserved = {
	created: boolean;
	user: string;
	reservationId: string;
	expiresAt: Date;
};

export type ReserveResult = Result<Reserved, ReserveError>;

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

// What must hold before the queue or a store is asked: the sale exists, the name is usable and the sale is selling.
function selling(
	found: SaleDetails | undefined,
	rawUser: unknown,
): Result<SaleDetails, ReserveError> {
	if (found === undefined) return new Err("sale_not_found");
	if (normalizeUser(rawUser) === undefined) return new Err("invalid_user");
	// A sale that is not selling answers first, so a shopper learns it without a valid ticket.
	const block = reserveBlock(found.view.status);
	return block === undefined ? new Ok(found) : new Err(block);
}

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

	// Redis decides when it can. When it fails, Postgres decides alone under the sale row lock, which is slower but
	// keeps the stock and the one item per user. That path writes the hold itself, so `written` is true.
	async function decide(
		request: ReserveRequest,
	): Promise<{ answer: GateAnswer; written: boolean }> {
		const viaRedis = await attemptAsync(() => viaGate(request), Error);
		if (viaRedis.isOk()) return { answer: viaRedis.value, written: false };

		gate.markStale(request.saleId);
		const fallback = await repository.reserveWithoutRedis(request, () =>
			gate.isReady(request.saleId),
		);
		if (fallback.kind === "redis_ready") {
			return { answer: await viaGate(request), written: false };
		}
		return { answer: fallback, written: true };
	}

	// Without its Postgres row a hold could not be rebuilt, so when the write fails the item goes back.
	async function remember(
		saleId: string,
		user: string,
		answer: Extract<GateAnswer, { kind: "reserved" }>,
	): Promise<void> {
		const saved = await attemptAsync(
			() =>
				repository.save({
					saleId,
					user,
					reservationId: answer.reservationId,
					expiresAt: answer.expiresAt,
				}),
			Error,
		);
		if (saved.isErr()) {
			await gate.release(saleId, user);
			throw saved.error;
		}
	}

	return {
		async reserve(
			saleId: string,
			rawUser: unknown,
			ticket: string | undefined,
		): Promise<ReserveResult> {
			const open = selling(await sales.details(saleId), rawUser);
			if (open.isErr()) return new Err(open.error);
			const { sale } = open.value;

			const entry = await queue.check(saleId, rawUser, ticket);
			if (entry.isErr()) {
				if (entry.error !== "not_in_queue") return new Err(entry.error);
				// The queue is only in Redis and can be lost. A shopper who already bought is told so, not sent back.
				const user = normalizeUser(rawUser);
				const bought =
					user !== undefined && (await repository.hasPurchase(saleId, user));
				return new Err(bought ? "already_purchased" : "not_admitted");
			}
			const { user, place } = entry.value;
			if (place.state !== "admitted") return new Err("not_admitted");

			const request = holdRequest(sale, user, randomUUID(), clock());
			const { answer, written } = await decide(request);

			switch (answer.kind) {
				case "reserved":
					if (!written) await remember(saleId, user, answer);
					return new Ok({
						created: true,
						user,
						reservationId: answer.reservationId,
						expiresAt: answer.expiresAt,
					});
				case "held":
					return new Ok({
						created: false,
						user,
						reservationId: answer.reservationId,
						expiresAt: answer.expiresAt,
					});
				case "purchased":
					return new Err("already_purchased");
				case "sold_out":
					return new Err("sold_out");
				case "not_ready":
					return new Err("unavailable");
			}
		},
	};
}
