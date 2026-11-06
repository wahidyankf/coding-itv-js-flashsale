import type { CHECK_ERRORS, JOIN_ERRORS } from "@flash/contract/vocabulary";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import type { QueuePlace } from "../domain/queue.js";
import { admissionsPerTick, queueBlock } from "../domain/sale.js";
import { issueTicket, ticketMatches } from "../domain/ticket.js";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { QueueStore } from "./ports/queue-store.js";
import type { SaleDetails, SaleService } from "./sale-service.js";

export type QueueOptions = {
	ticketSecret: string;
	admissionTickMs: number;
	admissionTtlSeconds: number;
};

export type JoinError = (typeof JOIN_ERRORS)[number];

export type Joined = {
	created: boolean;
	user: string;
	ticket: string;
	place: QueuePlace;
};

export type JoinResult = Result<Joined, JoinError>;

export type CheckError = (typeof CHECK_ERRORS)[number];

export type CheckResult = Result<
	{ user: string; place: QueuePlace },
	CheckError
>;

const ADMITTED: QueuePlace = { state: "admitted" };

// Who may join: the sale exists, the name is usable and the sale is not over. Pure, so it needs no store.
function admissible(
	found: SaleDetails | undefined,
	rawUser: unknown,
): Result<string, JoinError> {
	if (found === undefined) return new Err("sale_not_found");
	const user = normalizeUser(rawUser);
	if (user === undefined) return new Err("invalid_user");
	const block = queueBlock(found.view.status);
	return block === undefined ? new Ok(user) : new Err(block);
}

export type QueueService = ReturnType<typeof createQueueService>;

export function createQueueService(
	store: QueueStore,
	sales: SaleService,
	clock: Clock,
	options: QueueOptions,
) {
	return {
		async join(saleId: string, rawUser: unknown): Promise<JoinResult> {
			const admitted = admissible(await sales.details(saleId), rawUser);
			if (admitted.isErr()) return new Err(admitted.error);
			const user = admitted.value;

			// Without Redis there is no line. The shopper is let through, because the stock and the one item per
			// user are guarded by Postgres, and a stalled queue would stop the sale.
			const joined = await attemptAsync(
				() => store.join(saleId, user, clock()),
				Error,
			);
			const { place, created } = joined.match({
				ok: (line) => line,
				err: () => ({ place: ADMITTED, created: false }),
			});
			const ticket = issueTicket(options.ticketSecret, saleId, user);
			return new Ok({ created, user, ticket, place });
		},

		async check(
			saleId: string,
			rawUser: unknown,
			ticket: string | undefined,
		): Promise<CheckResult> {
			if ((await sales.byId(saleId)) === undefined) {
				return new Err("sale_not_found");
			}
			const user = normalizeUser(rawUser);
			if (user === undefined) return new Err("invalid_user");
			if (!ticketMatches(options.ticketSecret, saleId, user, ticket)) {
				return new Err("invalid_ticket");
			}

			const looked = await attemptAsync(
				() => store.place(saleId, user, clock()),
				Error,
			);
			const place = looked.match({ ok: (found) => found, err: () => ADMITTED });
			return place.state === "absent"
				? new Err("not_in_queue")
				: new Ok({ user, place });
		},

		// Admits the next shoppers of the sale that is open now. Several instances may call this; only one wins a tick.
		async admitTick(saleId: string): Promise<string[]> {
			const found = await sales.details(saleId);
			if (found?.view.status !== "active") return [];
			const { sale } = found;
			if (!(await store.tryLead(saleId, options.admissionTickMs - 1))) {
				return [];
			}
			return store.admit(
				saleId,
				admissionsPerTick(sale, options.admissionTickMs),
				clock(),
				options.admissionTtlSeconds,
			);
		},
	};
}
