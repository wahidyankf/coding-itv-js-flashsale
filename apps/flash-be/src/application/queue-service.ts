// The queue use case (application layer): a shopper joins the line for a sale and checks their place with the ticket they
// were given; the admission tick lets the next shoppers in. The line lives in the QueueStore (Redis). Without Redis there
// is no line, and shoppers are let through.
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import type { QueuePlace } from "../domain/queue.js";
import { admissionsPerTick, queueBlock, saleStatus } from "../domain/sale.js";
import { issueTicket, ticketMatches } from "../domain/ticket.js";
import type { Username } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { QueueStore } from "./ports/queue-store.js";
import type { UnreadableReply } from "./ports/reply.js";
import { actionableSale, type SaleService } from "./sale-service.js";

// The queue settings from configuration. Every instance must read the same values, or tickets and admissions disagree.
export type QueueOptions = {
	// Signs the queue tickets. Every instance must use the same secret, or a ticket from one fails on another.
	ticketSecret: string;
	// How often an admission tick runs, in milliseconds.
	admissionTickMs: number;
	// How long an admission lasts, in seconds: the time an admitted shopper has to reserve.
	admissionTtlSeconds: number;
};

// Why a shopper cannot join: the sale is missing, over, or sold out.
export type JoinError = "sale_not_found" | "sale_ended" | "sold_out";

// The place a shopper now has, with the ticket that proves it. `created` is true only for a new place in the line.
export type Joined = {
	created: boolean;
	user: Username;
	ticket: string;
	place: QueuePlace;
};

// The place the shopper got, or the reason they cannot join.
export type JoinResult = Result<Joined, JoinError>;

// Why a place cannot be checked: the sale is missing, the ticket is wrong, or the shopper is not in the line.
export type CheckError = "sale_not_found" | "invalid_ticket" | "not_in_queue";

// The shopper's place, once the ticket proves who they are and for which sale.
export type CheckResult = Result<
	{ user: Username; place: QueuePlace },
	CheckError
>;

// The queue use case as the HTTP adapter calls it. When the line cannot be read, join and check answer as admitted, so an outage does not stop the sale.
export type QueueService = {
	// Puts the shopper in the line, or returns their place if they are in it already.
	join: (saleId: string, user: Username) => Promise<JoinResult>;
	// Returns the shopper's place, if the ticket proves they joined this sale.
	check: (
		saleId: string,
		user: Username,
		ticket: string | undefined,
	) => Promise<CheckResult>;
	// Admits the next shoppers of the sale that is open now. Several instances may call this; only one wins a tick.
	admitTick: (saleId: string) => Promise<Username[]>;
};

const ADMITTED: QueuePlace = { state: "admitted" };

// The lead of a tick lasts one millisecond less than the tick. So the lead is free again by the next tick, and each
// tick has at most one leader.
const LEAD_SHORT_OF_TICK_MS = 1;

// One read of the line as a value: a thrown failure and an unreadable reply both mean the line cannot be read.
async function readLine<T>(
	call: () => Promise<Result<T, UnreadableReply>>,
): Promise<Result<T, Error | UnreadableReply>> {
	const outcome = await attemptAsync(call, Error);
	return outcome.isOk() ? outcome.value : new Err(outcome.error);
}

// Wires the queue use case over the line store and the sales it reads, with the settings passed in by the wiring.
export function createQueueService(
	store: QueueStore,
	sales: SaleService,
	clock: Clock,
	options: QueueOptions,
): QueueService {
	return {
		// `user` is the name of the account that is logged in, so it is already a valid name.
		async join(saleId, user) {
			const open = actionableSale(
				await sales.details(saleId),
				clock(),
				queueBlock,
			);
			if (open.isErr()) return new Err(open.error);

			// Without Redis there is no line. The shopper is let through, because the stock and the one item per user are
			// guarded by Postgres, and a stalled queue would stop the sale.
			const joined = await readLine(() => store.join(saleId, user, clock()));
			const { place, created } = joined.match({
				ok: (line) => line,
				err: () => ({ place: ADMITTED, created: false }),
			});
			const ticket = issueTicket(options.ticketSecret, saleId, user);
			return new Ok({ created, user, ticket, place });
		},

		async check(saleId, user, ticket) {
			if ((await sales.byId(saleId)) === undefined) {
				return new Err("sale_not_found");
			}
			if (!ticketMatches(options.ticketSecret, saleId, user, ticket)) {
				return new Err("invalid_ticket");
			}

			// Without Redis the place is taken as admitted, for the same reason as in `join`.
			const looked = await readLine(() => store.place(saleId, user, clock()));
			const place = looked.match({ ok: (found) => found, err: () => ADMITTED });
			return place.state === "absent"
				? new Err("not_in_queue")
				: new Ok({ user, place });
		},

		async admitTick(saleId) {
			const found = await sales.details(saleId);
			if (found === undefined || saleStatus(found, clock()) !== "active") {
				return [];
			}
			const leadMs = options.admissionTickMs - LEAD_SHORT_OF_TICK_MS;
			if (!(await store.tryLead(saleId, leadMs))) return [];
			// A reply that cannot be read admits nobody in this tick; the next tick tries again.
			const admitted = await store.admit(
				saleId,
				admissionsPerTick(found, options.admissionTickMs),
				clock(),
				options.admissionTtlSeconds,
			);
			return admitted.match({ ok: (names) => names, err: () => [] });
		},
	};
}
