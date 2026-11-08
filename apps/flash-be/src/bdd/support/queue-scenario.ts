// The contract of a queue scenario: what a scenario can do and read, whatever the layer. The unit layer answers it in
// memory (queue-world.ts) and the integration layer over Postgres and Redis (queue-integration.ts). The step bindings
// import these types, so the names stay the same.

import type { LedgerEntry } from "../../adapters/outbound/payment/payment-ledger.js";
import type { RateLimits } from "../../application/rate-limiter.js";
import type { Sale } from "../../domain/sale.js";
import type { Response } from "./response.js";

// A Server-Sent Events stream as a scenario reads it: the status of the opening reply, and the events one by one.
export type EventWatcher = {
	status: number;
	// The JSON body of a refusal. Empty for a stream that opened.
	body: { errorCode?: string };
	next: () => Promise<{ event: string; data: Record<string, unknown> }>;
	close: () => void;
};

// The reply type the queue steps read, re-exported so a caller of this world needs no second import.
export type { Response };

// The sale fields a scenario sets when it makes a sale. Both layers honour exactly these four, so nothing else is passed.
export type SaleOverrides = Partial<
	Pick<Sale, "stock" | "sold" | "startsAt" | "endsAt">
>;

// What a queue scenario does, whatever the layer. Unit tests answer it in memory; integration tests use Postgres and Redis.
export type QueueScenario = {
	saleId: string;
	response: Response | undefined;
	tickets: Map<string, string>;
	// The cookie header of a shopper who is logged in (an account is made the first time).
	login: (user: string) => Promise<string>;
	addSale: (overrides: SaleOverrides) => Promise<string>;
	setAdmitRate: (perSecond: number) => Promise<void>;
	// How long an admission lasts from now on. A server reads it from ADMISSION_TTL_SECONDS; a scenario shortens it.
	setAdmissionSeconds: (seconds: number) => Promise<void>;
	join: (user: string, saleId?: string) => Promise<Response>;
	check: (user: string, ticket?: string) => Promise<Response>;
	admit: (saleId?: string) => Promise<void>;
	loseQueue: () => Promise<void>;
};

// How many shoppers one admission call lets in: more than any queue in a scenario, so "everyone waiting" is admitted.
export const ADMIT_EVERYONE_WAITING = 1000;

// One hold row of the sale as the store keeps it. `deletedBy` names who marked it deleted, and `counts` is true while it is
// live and not yet expired, so a scenario can see that a hold taken again never overwrote the old one.
export type HoldRow = {
	user: string;
	reservationId: string;
	deletedBy: string | undefined;
	counts: boolean;
};

// The same, for reserving. A scenario that reserves also joins and admits shoppers, so it extends the queue scenario.
export type ShopScenario = QueueScenario & {
	holds: Map<string, { reservationId: string; expiresAt: string }>;
	setHoldSeconds: (seconds: number) => Promise<void>;
	// Joins the queue and gets admitted at once, without waiting for the timer.
	admitted: (user: string) => Promise<void>;
	admitMany: (users: string[]) => Promise<void>;
	reserve: (
		user: string,
		options?: { ticket?: string; saleId?: string },
	) => Promise<Response>;
	reserveAll: (users: string[]) => Promise<Response[]>;
	// Every hold row of the scenario's sale, the ones marked deleted too.
	holdRows: () => Promise<HoldRow[]>;
	// Time passes: the unit clock moves; other layers really wait.
	advance: (seconds: number) => Promise<void>;
	loseReservationState: () => Promise<void>;
	breakWrites: () => Promise<void>;
	fixWrites: () => Promise<void>;
	purchases: Map<string, { purchaseId: string }>;
	confirm: (
		user: string,
		options?: { reservationId?: string; saleId?: string; owner?: string },
	) => Promise<Response>;
	// Confirms without waiting for the answer; `finishConfirm` waits for it.
	startConfirm: (user: string) => Promise<void>;
	finishConfirm: () => Promise<void>;
	confirmAllHolders: (users: string[]) => Promise<Response[]>;
	outcome: (user: string, saleId?: string) => Promise<Response>;
	saleView: () => Promise<{ status: string; remaining: number }>;
	setPaymentDeclines: () => Promise<void>;
	setPaymentDuration: (seconds: number) => Promise<void>;
	// Another app instance sells the last item to this user, with no call through this app.
	sellLastItemTo: (user: string) => Promise<void>;
	// The ledger entry of the payment for the shopper's first hold, if it was ever charged or declined.
	paymentOf: (user: string) => Promise<LedgerEntry | undefined>;
	setPaymentAccepts: () => Promise<void>;
	// The shopper confirms their hold on two instances of the API at once, each with its own payment over one ledger.
	confirmOnTwoInstances: (user: string) => Promise<Response[]>;
	// The sale read cache: its time to live, and a change the cache does not see.
	setSaleCache: (ms: number) => Promise<void>;
	setSold: (sold: number) => Promise<void>;
	// The sale's window closes now, as if its end had come while the scenario ran.
	endSale: () => Promise<void>;
	readSale: () => Promise<Response>;
	readCurrentSale: () => Promise<Response>;
	// Live updates: a watcher per stream, and the sale opening while a shopper is already waiting.
	watcher: EventWatcher | undefined;
	watchSale: (saleId?: string) => Promise<EventWatcher>;
	watchPlace: (user: string, ticket?: string) => Promise<EventWatcher>;
	openSale: () => Promise<void>;
	// Redis stops answering, and answers again. What it held is untouched; `loseQueue` and
	// `loseReservationState` take the data away.
	breakRedis: () => Promise<void>;
	fixRedis: () => Promise<void>;
	setUserLimit: (requests: number, seconds: number) => Promise<void>;
	setAddressLimit: (requests: number, seconds: number) => Promise<void>;
	// The limit of the auth routes, counted by address alone.
	setLoginLimit: (requests: number, seconds: number) => Promise<void>;
	// One login with a wrong password, from the scenario's own address, so its count meets no other scenario's.
	tryLogin: (user: string) => Promise<Response>;
	// Sends the same kind of write request several times, one after the other.
	repeat: (kind: string, user: string, times: number) => Promise<Response[]>;
	joinMany: (count: number) => Promise<Response[]>;
	replies: Response[];
};

// The placeholder a request method holds until the request helpers replace it. Calling one is a bug in the scenario.
export function notWired(): never {
	throw new Error("replaced when the scenario is built");
}

// Every request method of a queue scenario, held as a placeholder. Both layers start from these, and the request helpers
// replace each one once the scenario exists, so a method that is never replaced fails at once.
export function placeholders() {
	return {
		join: notWired,
		check: notWired,
		tryLogin: notWired,
		reserve: notWired,
		reserveAll: notWired,
		repeat: notWired,
		joinMany: notWired,
		readSale: notWired,
		readCurrentSale: notWired,
		watchSale: notWired,
		watchPlace: notWired,
		confirm: notWired,
		startConfirm: notWired,
		finishConfirm: notWired,
		confirmAllHolders: notWired,
		outcome: notWired,
		saleView: notWired,
	};
}

// The rate limits a scenario starts with: far out of reach, so only the rate limit scenarios ever meet them. Copy it,
// because the limits are changed in place.
export const LIMITS_OUT_OF_REACH: RateLimits = {
	windowSeconds: 60,
	perUser: 100_000,
	perIp: 100_000,
	authPerIp: 100_000,
};
