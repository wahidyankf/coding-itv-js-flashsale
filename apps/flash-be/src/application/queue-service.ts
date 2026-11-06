import type { CHECK_ERRORS, JOIN_ERRORS } from "@flash/contract/vocabulary";
import {
	attemptAsync,
	Err,
	Ok,
	type Option,
	option,
	pipe,
	type Result,
	result,
} from "@flash/typekit";
import type { QueuePlace } from "../domain/queue.js";
import {
	admissionsPerTick,
	type QueueBlock,
	queueBlock,
} from "../domain/sale.js";
import { issueTicket, ticketMatches } from "../domain/ticket.js";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { QueueStore } from "./ports/queue-store.js";
import type { SaleDetails, SaleService } from "./sale-service.js";
import type { SaleView } from "./sale-view.js";

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
	found: Option<SaleDetails>,
	rawUser: unknown,
): Result<string, JoinError> {
	return pipe(
		found,
		option.okOr<SaleDetails, JoinError>("sale_not_found"),
		result.flatMap(({ view }: SaleDetails) =>
			pipe(
				normalizeUser(rawUser),
				option.okOr<string, JoinError>("invalid_user"),
				result.flatMap((user: string) =>
					pipe(
						queueBlock(view.status),
						option.match<QueueBlock, Result<string, JoinError>>({
							some: (block) => new Err(block),
							none: () => new Ok(user),
						}),
					),
				),
			),
		),
	);
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
			const checked = pipe(
				await sales.byId(saleId),
				option.okOr<SaleView, CheckError>("sale_not_found"),
				result.flatMap(() =>
					pipe(
						normalizeUser(rawUser),
						option.okOr<string, CheckError>("invalid_user"),
					),
				),
				result.flatMap((user: string) =>
					ticketMatches(options.ticketSecret, saleId, user, ticket)
						? new Ok(user)
						: new Err<string, CheckError>("invalid_ticket"),
				),
			);
			if (checked.isErr()) return new Err(checked.error);
			const user = checked.value;

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
			if (found?.value.view.status !== "active") return [];
			const { sale } = found.value;
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
