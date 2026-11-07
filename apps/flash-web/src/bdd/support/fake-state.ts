// What the fake flash-be remembers: the sale and its stock, the holds, the queue, the accounts and their sessions, and the
// knobs a scenario turns. The route handlers in the other fake-* files read and change it, and the rules they all read
// (the status of the sale, a shopper's place, the live holds) are here. Test support only.
import { cleanUser } from "../../auth/messages";
import type { Place, SaleStatus, SaleView } from "../../sale/types";
import { ERROR_STATUS, errorPayload, type Reply, reply } from "./fake-http";

// The id of the one sale the fake knows about.
export const SALE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

// A sale as a scenario describes it: its stock, how many are sold, and its window.
export type SaleSpec = {
	name?: string;
	stock: number;
	sold: number;
	startsAt: Date;
	endsAt: Date;
};

// A hold: the item kept for a shopper until `expiresAt` (epoch milliseconds).
export type Hold = { reservationId: string; expiresAt: number };
// A completed purchase, as the fake keeps it.
export type Purchase = {
	purchaseId: string;
	reservationId: string;
	purchasedAt: string;
};

// One login of one shopper. `previous` is the refresh token that was traded in, which must not work again.
export type Session = {
	user: string;
	access: string;
	accessEndsAt: number;
	refresh: string;
	refreshEndsAt: number;
	previous: string | undefined;
};

// The knobs a scenario turns: slow admission, declined payments, the hold's length, and a write limit.
export type Settings = {
	slowAdmission: boolean;
	paymentDeclines: boolean;
	holdSeconds: number;
	// Zero means no limit.
	writesPerUser: number;
};

// Everything the fake remembers. The handlers read it and change it.
export type FakeState = {
	now: () => number;
	sale: SaleSpec | undefined;
	unreachable: boolean;
	bought: Map<string, Purchase>;
	holds: Map<string, Hold>;
	// The users waiting in line, in order, and the users admitted to buy.
	waiting: string[];
	admitted: Set<string>;
	writes: Map<string, number>;
	settings: Settings;
	// Accounts by name. The name is the user in everything else.
	accounts: Map<string, { password: string; role: "shopper" }>;
	sessions: Session[];
	requests: number;
	listeners: Set<() => void>;
};

// Makes an empty fake: no sale, no holds, no accounts.
export function createFakeState(now: () => number): FakeState {
	return {
		now,
		sale: undefined,
		unreachable: false,
		bought: new Map(),
		holds: new Map(),
		waiting: [],
		admitted: new Set(),
		writes: new Map(),
		settings: {
			slowAdmission: false,
			paymentDeclines: false,
			holdSeconds: 120,
			writesPerUser: 0,
		},
		accounts: new Map(),
		sessions: [],
		requests: 0,
		listeners: new Set(),
	};
}

// Tells every listener that something changed, so the streams can push it.
export function changed(state: FakeState): void {
	for (const listener of [...state.listeners]) listener();
}

// The status of the sale at this moment, as flash-be works it out from the window and the stock.
export function statusOf(state: FakeState): SaleStatus {
	const sale = state.sale;
	if (!sale) throw new Error("no sale");
	const at = state.now();
	if (at < sale.startsAt.getTime()) return "upcoming";
	if (at >= sale.endsAt.getTime()) return "ended";
	return sale.sold >= sale.stock ? "sold_out" : "active";
}

// The sale as the API shows it.
export function viewOf(state: FakeState): SaleView {
	const sale = state.sale;
	if (!sale) throw new Error("no sale");
	return {
		id: SALE_ID,
		productId: PRODUCT_ID,
		name: sale.name ?? "Flash sale",
		status: statusOf(state),
		startsAt: sale.startsAt.toISOString(),
		endsAt: sale.endsAt.toISOString(),
		stock: sale.stock,
		remaining: Math.max(sale.stock - sale.sold, 0),
	};
}

// Where a shopper stands: admitted, waiting with a place, or not in the line at all.
export function placeOf(state: FakeState, user: string): Place {
	if (state.admitted.has(user)) return { state: "admitted" };
	const index = state.waiting.indexOf(user);
	return index >= 0
		? { state: "waiting", place: index + 1 }
		: { state: "absent" };
}

// The number of holds that have not run out. Stock on hold is not for sale.
export function liveHoldCount(state: FakeState): number {
	const at = state.now();
	return [...state.holds.values()].filter((hold) => hold.expiresAt > at).length;
}

// A moment as flash-be writes it in JSON: an ISO string, in UTC.
export const isoOf = (at: number) => new Date(at).toISOString();

// The queue ticket flash-be would give this shopper.
export const ticketOf = (user: string) => `ticket-${user}`;

// Whether flash-be would accept this user name at all.
export const usable = (user: string) => cleanUser(user) !== undefined;

// Counts a write from this user. Returns the 429 reply when the user is over the limit, and nothing otherwise.
export function limited(state: FakeState, user: string): Reply | undefined {
	const limit = state.settings.writesPerUser;
	if (limit === 0) return undefined;
	const count = (state.writes.get(user) ?? 0) + 1;
	state.writes.set(user, count);
	return count > limit
		? reply(
				ERROR_STATUS.rate_limited,
				{ ...errorPayload("rate_limited"), retryAfterSeconds: 30 },
				{ "retry-after": "30" },
			)
		: undefined;
}
