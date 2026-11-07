// The reserve use case: an admitted shopper asks for one item of a sale. The sale must be selling and the queue must have
// admitted the shopper. Then the fast gate decides, and when the gate is down the reservation repository decides alone.
import { randomUUID } from "node:crypto";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import {
	type GateAnswer,
	holdRequest,
	type ReserveRequest,
} from "../domain/reservation.js";
import { reserveBlock } from "../domain/sale.js";
import type { Username } from "../domain/user.js";
import type { GuardedGate } from "./guarded-gate.js";
import type { Clock } from "./ports/clock.js";
import type { ReservationRepository } from "./ports/reservation-repository.js";
import type { QueueService } from "./queue-service.js";
import { actionableSale, type SaleService } from "./sale-service.js";

// Why a reservation is refused. Each one tells the shopper what to do next: wait, come back, or stop.
export type ReserveError =
	| "sale_not_found"
	| "invalid_ticket"
	| "not_admitted"
	| "sale_not_started"
	| "sale_ended"
	| "sold_out"
	| "already_purchased"
	| "unavailable";

// The hold of a shopper. `created` is true for a new hold and false when the shopper already held one, so a retry
// gets the same hold back and nothing is written twice.
export type Reserved = {
	created: boolean;
	user: Username;
	reservationId: string;
	expiresAt: Date;
};

export type ReserveResult = Result<Reserved, ReserveError>;

// How a request waits for another instance that is rebuilding the sale's reservation state.
export type ReservationOptions = {
	// How long to wait before the request gives up with `unavailable`.
	rebuildWaitMs: number;
	// How to wait; tests replace it so no real time passes.
	wait: (ms: number) => Promise<void>;
};

// Long enough for a rebuild of one sale's holds, and short enough that a shopper is not left hanging.
const DEFAULT_REBUILD_WAIT_MS = 3000;
// The rebuild lock outlives a normal rebuild, and expires by itself if the instance that holds it dies.
const REBUILD_LOCK_MS = 10_000;
// How often a waiting request checks whether the rebuild has finished.
const POLL_MS = 25;

export const defaultReservationOptions: ReservationOptions = {
	rebuildWaitMs: DEFAULT_REBUILD_WAIT_MS,
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// What the reservation service is built from. `options` may be left out; the defaults then apply.
export type ReservationDeps = {
	gate: GuardedGate;
	repository: ReservationRepository;
	sales: SaleService;
	queue: QueueService;
	clock: Clock;
	options?: ReservationOptions;
};

export type ReservationService = {
	// One shopper's attempt to hold an item. `ticket` is the queue ticket the client sent, if any.
	reserve: (
		saleId: string,
		user: Username,
		ticket: string | undefined,
	) => Promise<ReserveResult>;
};

// The reply for each answer of the gate. A refusal names its reason; a hold that already exists comes back as it was.
function replyFor(answer: GateAnswer, user: Username): ReserveResult {
	switch (answer.kind) {
		case "reserved":
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
}

export function createReservationService(
	deps: ReservationDeps,
): ReservationService {
	const { gate, repository, sales, queue, clock } = deps;
	const options = deps.options ?? defaultReservationOptions;

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
		user: Username,
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

	// Whether the queue lets this shopper reserve now. The queue lives in Redis and can be lost, so a shopper who already
	// bought is told so, rather than sent back to the queue.
	async function admitted(
		saleId: string,
		user: Username,
		ticket: string | undefined,
	): Promise<Result<true, ReserveError>> {
		const entry = await queue.check(saleId, user, ticket);
		if (entry.isErr()) {
			if (entry.error !== "not_in_queue") return new Err(entry.error);
			const bought = await repository.hasPurchase(saleId, user);
			return new Err(bought ? "already_purchased" : "not_admitted");
		}
		return entry.value.place.state === "admitted"
			? new Ok(true)
			: new Err("not_admitted");
	}

	return {
		async reserve(saleId, user, ticket) {
			const open = actionableSale(
				await sales.details(saleId),
				clock(),
				reserveBlock,
			);
			if (open.isErr()) return new Err(open.error);

			const inLine = await admitted(saleId, user, ticket);
			if (inLine.isErr()) return new Err(inLine.error);

			const request = holdRequest(open.value, user, randomUUID(), clock());
			const { answer, written } = await decide(request);
			if (answer.kind === "reserved" && !written) {
				await remember(saleId, user, answer);
			}
			return replyFor(answer, user);
		},
	};
}
