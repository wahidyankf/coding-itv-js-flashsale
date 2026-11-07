import { TICKET_HEADER } from "../../api";
import { cleanUser } from "../../sale/messages";
import type { Place, SaleStatus, SaleView } from "../../sale/types";

export const SALE_ID = "11111111-1111-4111-8111-111111111111";

export type SaleSpec = {
	name?: string;
	stock: number;
	sold: number;
	startsAt: Date;
	endsAt: Date;
};

export type Reply = {
	status: number;
	headers: Record<string, string>;
	body: unknown;
};

// The error codes the fake answers with, and the one status of each, as flash-be does.
const ERROR_STATUS = {
	invalid_user: 400,
	invalid_ticket: 401,
	payment_failed: 402,
	not_admitted: 403,
	sale_not_found: 404,
	reservation_not_found: 404,
	not_found: 404,
	sale_not_started: 409,
	sale_ended: 409,
	sold_out: 409,
	hold_expired: 409,
	already_purchased: 409,
	rate_limited: 429,
} as const;
type ErrorCode = keyof typeof ERROR_STATUS;

const errorPayload = (code: ErrorCode) => ({
	errorCode: code,
	errorMessage: code.replaceAll("_", " "),
});

const reply = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Reply => ({ status, headers, body });
const refuse = (error: ErrorCode) =>
	reply(ERROR_STATUS[error], errorPayload(error));

// The routes of flash-be that the page can reach, each with its method and path.
export type RouteName =
	| "currentSale"
	| "sale"
	| "saleEvents"
	| "placeEvents"
	| "joinQueue"
	| "checkPlace"
	| "reserve"
	| "confirm"
	| "outcome";
const ROUTES: Array<[RouteName, string, RegExp]> = [
	["currentSale", "GET", /^\/sales\/current$/],
	["sale", "GET", /^\/sales\/(?<saleId>[^/]+)$/],
	["saleEvents", "GET", /^\/sales\/(?<saleId>[^/]+)\/events$/],
	["joinQueue", "POST", /^\/sales\/(?<saleId>[^/]+)\/queue$/],
	["checkPlace", "GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/(?<userId>[^/]+)$/],
	[
		"placeEvents",
		"GET",
		/^\/sales\/(?<saleId>[^/]+)\/queue\/(?<userId>[^/]+)\/events$/,
	],
	["reserve", "POST", /^\/sales\/(?<saleId>[^/]+)\/reservations$/],
	["confirm", "POST", /^\/sales\/(?<saleId>[^/]+)\/purchases$/],
	[
		"outcome",
		"GET",
		/^\/sales\/(?<saleId>[^/]+)\/purchases\/(?<userId>[^/]+)$/,
	],
];

export type Match = { name: RouteName; params: Record<string, string> };

export function matchRoute(method: string, path: string): Match | undefined {
	for (const [name, allowed, pattern] of ROUTES) {
		if (allowed !== method) continue;
		const found = pattern.exec(path);
		if (!found) continue;
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(found.groups ?? {})) {
			params[key] = decodeURIComponent(value);
		}
		return { name, params };
	}
	return undefined;
}

// A small stand-in for flash-be that follows its rules for status codes, errors and what a shopper sees, but keeps
// everything in memory. The unit scenarios call it directly. The integration scenarios put an HTTP server in front of
// it. Time comes from `now`, so a scenario can move it.
export function createFakeBackend(now: () => number) {
	let sale: SaleSpec | undefined;
	let unreachable = false;
	const bought = new Map<
		string,
		{ purchaseId: string; reservationId: string; purchasedAt: string }
	>();
	const holds = new Map<string, { reservationId: string; expiresAt: number }>();
	const waiting: string[] = [];
	const admitted = new Set<string>();
	const writes = new Map<string, number>();
	const settings = {
		slowAdmission: false,
		paymentDeclines: false,
		holdSeconds: 120,
		// Zero means no limit.
		writesPerUser: 0,
	};
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const listener of [...listeners]) listener();
	};

	function status(): SaleStatus {
		if (!sale) throw new Error("no sale");
		const at = now();
		if (at < sale.startsAt.getTime()) return "upcoming";
		if (at >= sale.endsAt.getTime()) return "ended";
		return sale.sold >= sale.stock ? "sold_out" : "active";
	}

	function view(): SaleView {
		if (!sale) throw new Error("no sale");
		return {
			id: SALE_ID,
			name: sale.name ?? "Flash sale",
			status: status(),
			startsAt: sale.startsAt.toISOString(),
			endsAt: sale.endsAt.toISOString(),
			stock: sale.stock,
			remaining: Math.max(sale.stock - sale.sold, 0),
		};
	}

	function placeOf(user: string): Place {
		if (admitted.has(user)) return { state: "admitted" };
		const index = waiting.indexOf(user);
		return index >= 0
			? { state: "waiting", place: index + 1 }
			: { state: "absent" };
	}

	function liveHolds(): number {
		const at = now();
		return [...holds.values()].filter((hold) => hold.expiresAt > at).length;
	}

	const ticketOf = (user: string) => `ticket-${user}`;

	// Counts a write request. Returns the 429 reply when the user is over the limit.
	function limited(user: string): Reply | undefined {
		if (settings.writesPerUser === 0) return undefined;
		const count = (writes.get(user) ?? 0) + 1;
		writes.set(user, count);
		return count > settings.writesPerUser
			? reply(
					ERROR_STATUS.rate_limited,
					{ ...errorPayload("rate_limited"), retryAfterSeconds: 30 },
					{ "retry-after": "30" },
				)
			: undefined;
	}

	const usable = (user: string) => cleanUser(user) !== undefined;

	function join(user: string): Reply {
		const wait = limited(user);
		if (wait) return wait;
		if (!sale) return refuse("sale_not_found");
		if (!usable(user)) return refuse("invalid_user");
		const state = status();
		if (state === "ended") return refuse("sale_ended");
		if (state === "sold_out") return refuse("sold_out");
		const known = placeOf(user).state !== "absent";
		if (!known) {
			if (settings.slowAdmission) waiting.push(user);
			else admitted.add(user);
			changed();
		}
		return reply(known ? 200 : 201, {
			userId: user,
			ticket: ticketOf(user),
			...placeOf(user),
		});
	}

	function reserve(user: string, ticket: string | undefined): Reply {
		const wait = limited(user);
		if (wait) return wait;
		if (!sale) return refuse("sale_not_found");
		if (!usable(user)) return refuse("invalid_user");
		const state = status();
		if (state === "upcoming") return refuse("sale_not_started");
		if (state === "ended") return refuse("sale_ended");
		if (state === "sold_out") return refuse("sold_out");
		if (ticket !== ticketOf(user)) return refuse("invalid_ticket");
		if (!admitted.has(user)) return refuse("not_admitted");
		if (bought.has(user)) return refuse("already_purchased");
		const own = holds.get(user);
		if (own && own.expiresAt > now()) {
			return reply(200, {
				userId: user,
				reservationId: own.reservationId,
				expiresAt: new Date(own.expiresAt).toISOString(),
			});
		}
		if (bought.size + liveHolds() >= (sale?.stock ?? 0)) {
			return refuse("sold_out");
		}
		const hold = {
			reservationId: crypto.randomUUID(),
			expiresAt: now() + settings.holdSeconds * 1000,
		};
		holds.set(user, hold);
		return reply(201, {
			userId: user,
			reservationId: hold.reservationId,
			expiresAt: new Date(hold.expiresAt).toISOString(),
		});
	}

	function confirm(user: string, reservationId: string): Reply {
		const wait = limited(user);
		if (wait) return wait;
		if (!sale) return refuse("sale_not_found");
		const earlier = bought.get(user);
		if (earlier) {
			// Sending the same payment again is safe; anything else is a second purchase.
			return earlier.reservationId === reservationId
				? reply(200, { userId: user, ...earlier })
				: refuse("already_purchased");
		}
		const hold = holds.get(user);
		if (!hold || hold.reservationId !== reservationId) {
			return refuse("reservation_not_found");
		}
		if (hold.expiresAt <= now()) return refuse("hold_expired");
		if (settings.paymentDeclines) return refuse("payment_failed");
		const purchase = {
			purchaseId: crypto.randomUUID(),
			reservationId,
			purchasedAt: new Date(now()).toISOString(),
		};
		bought.set(user, purchase);
		holds.delete(user);
		sale.sold += 1;
		changed();
		return reply(201, { userId: user, ...purchase });
	}

	function outcome(user: string): Reply {
		if (!sale) return refuse("sale_not_found");
		const purchase = bought.get(user);
		if (purchase) {
			return reply(200, {
				userId: user,
				...purchase,
				state: "purchased",
			});
		}
		const hold = holds.get(user);
		if (hold && hold.expiresAt > now()) {
			return reply(200, {
				userId: user,
				state: "holding",
				reservationId: hold.reservationId,
				expiresAt: new Date(hold.expiresAt).toISOString(),
			});
		}
		return reply(200, { userId: user, state: "none" });
	}

	return {
		settings,
		onChange(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		// Scenario setup.
		setSale(spec: SaleSpec | undefined) {
			sale = spec;
			changed();
		},
		cutOff(value: boolean) {
			unreachable = value;
		},
		isCutOff: () => unreachable,
		setSold(sold: number) {
			if (sale) sale.sold = sold;
			changed();
		},
		endSale() {
			if (sale) sale.endsAt = new Date(now() - 1000);
			changed();
		},
		// Puts `count` other shoppers ahead in the line. They are never admitted.
		queueAhead(count: number) {
			for (let index = 0; index < count; index++) {
				waiting.push(`shopper${index}`);
			}
			changed();
		},
		giveHold(user: string) {
			admitted.add(user);
			holds.set(user, {
				reservationId: crypto.randomUUID(),
				expiresAt: now() + settings.holdSeconds * 1000,
			});
			changed();
		},
		giveItem(user: string) {
			bought.set(user, {
				purchaseId: crypto.randomUUID(),
				reservationId: crypto.randomUUID(),
				purchasedAt: new Date(now()).toISOString(),
			});
			if (sale) sale.sold += 1;
			changed();
		},
		view,
		placeOf,
		hasSale: () => sale !== undefined,
		// The API. `path` is the path of the contract, such as `/sales/current`.
		handle(
			method: string,
			path: string,
			headers: Record<string, string | undefined>,
			body: Record<string, unknown>,
		): Reply {
			if (unreachable) throw new TypeError("fetch failed");
			const match = matchRoute(method, path);
			if (!match) return refuse("not_found");
			const { name: route, params } = match;
			if (route === "currentSale") {
				// Like the real API: a sale that is over is no longer the current sale.
				return sale && view().status !== "ended"
					? reply(200, view())
					: refuse("sale_not_found");
			}
			if (params.saleId !== SALE_ID || !sale) return refuse("sale_not_found");
			const name = String(body.userId ?? params.userId ?? "")
				.trim()
				.toLowerCase();
			switch (route) {
				case "sale":
					return reply(200, view());
				case "joinQueue":
					return join(name);
				case "reserve":
					return reserve(name, headers[TICKET_HEADER]);
				case "confirm":
					return confirm(name, String(body.reservationId ?? ""));
				case "outcome":
					return outcome(name);
				default:
					return refuse("not_found");
			}
		},
	};
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;
