// The reserve use case (application layer). The sale must be open and the queue must have admitted the shopper. The fast
// gate decides; when it is down, the reservation repository decides alone. Ids, random draws and waits come in through
// the deps, so the service reads no clock or randomness of its own.
import {
	type BackoffPolicy,
	backoffDelayMs,
	retryAsync,
} from "@flash/flash-commons";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { reserveRefusalOf } from "../domain/queue.js";
import {
	type GateAnswer,
	holdRequest,
	type ReserveRequest,
} from "../domain/reservation.js";
import { reserveBlock } from "../domain/sale.js";
import type { Username } from "../domain/user.js";
import type { GuardedGate } from "./guarded-gate.js";
import type { Clock } from "./ports/clock.js";
import type { UnreadableReply } from "./ports/reply.js";
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

// The reserve answer: a hold, or the reason it was refused.
export type ReserveResult = Result<Reserved, ReserveError>;

// How a request waits for another instance that is rebuilding the sale's reservation state.
export type ReservationOptions = {
	// The longest a request waits for that rebuild before it gives up with `unavailable`.
	rebuildWaitMs: number;
	// How to wait; tests replace it so no real time passes.
	wait: (ms: number) => Promise<void>;
	// The random draw that full jitter scales each wait by, in [0, 1). Injected so tests can fix it and know each wait.
	random: () => number;
};

// The rebuild lock outlives a normal rebuild, and expires by itself if the instance that holds it dies. Its length is a
// fact of the rebuild, so it is named here rather than passed in.
const REBUILD_LOCK_MS = 10_000;
// A waiting request polls the gate with backoff and full jitter (decision 017), so waiters do not all retry at once.
const REBUILD_POLL: BackoffPolicy = { baseMs: 25, capMs: 500 };
// Tries are counted from one: the first try has no wait before it, so n tries mean n - 1 waits.
const ONE_TRY = 1;
const NO_WAIT = 0;
// A draw at the top of its range, so each wait takes its whole bound: the longest a wait can be.
const WHOLE_BOUND = 1;
const topOfRange = () => WHOLE_BOUND;

// The longest the wait with this 0-based index can be: its bound under the rebuild policy.
function bound(wait: number): number {
	return backoffDelayMs(wait, REBUILD_POLL, topOfRange);
}

// The most tries whose waits, each at its bound, add up to no more than `budgetMs`. The sum of the bounds is the
// longest the polling can wait, so it never runs past the rebuild wait, even when every draw is at its top.
function pollTries(budgetMs: number): number {
	let tries = ONE_TRY;
	let spent = NO_WAIT;
	let next = bound(NO_WAIT);
	while (spent + next <= budgetMs) {
		spent += next;
		tries += ONE_TRY;
		next = bound(tries - ONE_TRY);
	}
	return tries;
}

// What the reservation service is built from. Every part is required: composition.ts passes the real ones, and a test
// passes its own, so no default reads the clock, the randomness or a timer inside this layer.
export type ReservationDeps = {
	gate: GuardedGate;
	repository: ReservationRepository;
	sales: SaleService;
	queue: QueueService;
	clock: Clock;
	// Makes the id of a new hold, and the owner token of a rebuild lock. composition.ts passes a random UUID.
	newId: () => string;
	options: ReservationOptions;
};

// The reserve use case as the HTTP adapter calls it. The gate decides when it can; Postgres decides alone when it cannot.
export type ReservationService = {
	// One shopper's attempt to hold an item. `ticket` is the queue ticket the client sent, if any.
	reserve: (
		saleId: string,
		user: Username,
		ticket: string | undefined,
	) => Promise<ReserveResult>;
};

// What a decision may answer: the gate's answers, or that the sale was removed while the request ran.
type Answer = GateAnswer | { kind: "sale_not_found" };

// The reply for each answer. A refusal names its reason; a hold that already exists comes back as it was.
function replyFor(answer: Answer, user: Username): ReserveResult {
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
		case "sale_not_found":
			return new Err("sale_not_found");
	}
}

// The parts a rebuild may use. Nothing else from the service reaches the rebuild.
type RebuildDeps = Pick<
	ReservationDeps,
	"gate" | "repository" | "clock" | "newId"
> & {
	options: ReservationOptions;
};

// Rebuilds the sale's reservation state in Redis from Postgres. One instance does it. The others poll the gate with
// backoff, for at most the rebuild wait, and then give up with `not ready`.
async function ensureReady(
	deps: RebuildDeps,
	saleId: string,
): Promise<boolean> {
	const { gate, repository, clock, newId, options } = deps;
	if (await gate.isReady(saleId)) return true;
	const owner = newId();
	if (await gate.lockRebuild(saleId, REBUILD_LOCK_MS, owner)) {
		try {
			await repository.rebuild(saleId, clock(), (snapshot) =>
				gate.restore(saleId, snapshot),
			);
		} finally {
			await gate.unlockRebuild(saleId, owner);
		}
		return true;
	}
	const polled = await retryAsync(
		async (): Promise<Result<true, "not_ready">> =>
			(await gate.isReady(saleId)) ? new Ok(true) : new Err("not_ready"),
		{
			...REBUILD_POLL,
			maxAttempts: pollTries(options.rebuildWaitMs),
			sleep: options.wait,
			random: options.random,
		},
	);
	return polled.isOk();
}

// Wires the reserve use case. Its deps are the only inputs, so a test can replace any of them.
export function createReservationService(
	deps: ReservationDeps,
): ReservationService {
	const { gate, repository, sales, queue, clock, newId, options } = deps;
	const rebuild: RebuildDeps = { gate, repository, clock, newId, options };

	// The fast path: ask the gate, and rebuild its state first when it has none. An answer that cannot be read comes back
	// as a failure value, and the caller treats it as the gate being down.
	async function viaGate(
		request: ReserveRequest,
	): Promise<Result<GateAnswer, UnreadableReply>> {
		const first = await gate.reserve(request);
		if (first.isErr() || first.value.kind !== "not_ready") return first;
		if (!(await ensureReady(rebuild, request.saleId))) {
			return new Ok({ kind: "not_ready" });
		}
		return gate.reserve(request);
	}

	// Redis decides when it can. When it fails, Postgres decides alone under the sale row lock, which is slower but
	// keeps the stock and the one item per user. That path writes the hold itself, so `written` is true.
	async function decide(
		request: ReserveRequest,
	): Promise<{ answer: Answer; written: boolean }> {
		const viaRedis = await attemptAsync(() => viaGate(request), Error);
		if (viaRedis.isOk() && viaRedis.value.isOk()) {
			return { answer: viaRedis.value.value, written: false };
		}

		gate.markStale(request.saleId);
		const fallback = await repository.reserveWithoutGate(request, () =>
			gate.isReady(request.saleId),
		);
		if (fallback.kind === "gate_ready") {
			// The gate is back. An answer that still cannot be read is the gate being down, so it is not_ready.
			const again = await viaGate(request);
			return {
				answer: again.isOk() ? again.value : { kind: "not_ready" },
				written: false,
			};
		}
		return { answer: fallback, written: true };
	}

	// Without its Postgres row a hold could not be rebuilt, so when the write fails the item goes back. The save's failure
	// is the outcome, even when the release fails too: the guarded gate has marked the sale stale, so the rebuild drops
	// the hold.
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
			await attemptAsync(() => gate.release(saleId, user), Error);
			throw saved.error;
		}
	}

	// Whether the queue lets this shopper reserve now. The queue lives in Redis and can be lost, so a shopper who already
	// bought is told so, rather than sent back to the queue. The rule is the domain's (`reserveRefusalOf`); the purchase
	// record is read only when the shopper is not in the line.
	async function admitted(
		saleId: string,
		user: Username,
		ticket: string | undefined,
	): Promise<Result<true, ReserveError>> {
		const entry = await queue.check(saleId, user, ticket);
		if (entry.isErr() && entry.error !== "not_in_queue") {
			return new Err(entry.error);
		}
		const place = entry.isOk() ? entry.value.place : undefined;
		const bought =
			place === undefined && (await repository.hasPurchase(saleId, user));
		const refusal = reserveRefusalOf(place, bought);
		return refusal === undefined ? new Ok(true) : new Err(refusal);
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

			const request = holdRequest(open.value, user, newId(), clock());
			const { answer, written } = await decide(request);
			if (answer.kind === "reserved" && !written) {
				await remember(saleId, user, answer);
			}
			return replyFor(answer, user);
		},
	};
}
