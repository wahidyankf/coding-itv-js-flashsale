import type { Clock } from "../clock.js";
import type { SaleService } from "../sales/sale-service.js";
import type { QueuePlace, QueueStore } from "./queue-store.js";
import { issueTicket, ticketMatches } from "./ticket.js";
import { normalizeUser } from "./user.js";

export type QueueOptions = {
	ticketSecret: string;
	admissionTickMs: number;
	admissionTtlSeconds: number;
};

export type JoinResult =
	| {
			ok: true;
			created: boolean;
			user: string;
			ticket: string;
			place: QueuePlace;
	  }
	| {
			ok: false;
			error: "sale_not_found" | "invalid_user" | "sale_ended" | "sold_out";
	  };

export type CheckResult =
	| { ok: true; user: string; place: QueuePlace }
	| {
			ok: false;
			error:
				| "sale_not_found"
				| "invalid_user"
				| "invalid_ticket"
				| "not_in_queue";
	  };

const ADMITTED: QueuePlace = { state: "admitted" };

export type QueueService = ReturnType<typeof createQueueService>;

export function createQueueService(
	store: QueueStore,
	sales: SaleService,
	clock: Clock,
	options: QueueOptions,
) {
	return {
		async join(saleId: string, rawUser: unknown): Promise<JoinResult> {
			const found = await sales.details(saleId);
			if (!found) return { ok: false, error: "sale_not_found" };
			const sale = found.view;
			const user = normalizeUser(rawUser);
			if (!user) return { ok: false, error: "invalid_user" };
			if (sale.status === "ended") return { ok: false, error: "sale_ended" };
			if (sale.status === "sold_out") return { ok: false, error: "sold_out" };

			// Without Redis there is no line. The shopper is let through, because the stock and the one item per
			// user are guarded by Postgres, and a stalled queue would stop the sale.
			const { place, created } = await store
				.join(saleId, user, clock())
				.catch(() => ({ place: ADMITTED, created: false }));
			const ticket = issueTicket(options.ticketSecret, saleId, user);
			return { ok: true, created, user, ticket, place };
		},

		async check(
			saleId: string,
			rawUser: unknown,
			ticket: string | undefined,
		): Promise<CheckResult> {
			if (!(await sales.byId(saleId))) {
				return { ok: false, error: "sale_not_found" };
			}
			const user = normalizeUser(rawUser);
			if (!user) return { ok: false, error: "invalid_user" };
			if (!ticketMatches(options.ticketSecret, saleId, user, ticket)) {
				return { ok: false, error: "invalid_ticket" };
			}
			const place = await store
				.place(saleId, user, clock())
				.catch(() => ADMITTED);
			if (place.state === "absent") return { ok: false, error: "not_in_queue" };
			return { ok: true, user, place };
		},

		// Admits the next shoppers of the sale that is open now. Several instances may call this; only one wins a tick.
		async admitTick(saleId: string): Promise<string[]> {
			const found = await sales.details(saleId);
			if (found?.view.status !== "active") return [];
			const { sale } = found;
			if (!(await store.tryLead(saleId, options.admissionTickMs - 1))) {
				return [];
			}
			const perTick = Math.max(
				1,
				Math.round((sale.admitPerSecond * options.admissionTickMs) / 1000),
			);
			return store.admit(saleId, perTick, clock(), options.admissionTtlSeconds);
		},
	};
}
