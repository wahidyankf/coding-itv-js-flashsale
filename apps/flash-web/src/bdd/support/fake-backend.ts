import { TICKET_HEADER } from "../../api";
import { cleanPassword } from "../../auth/messages";
import { cleanUser } from "../../sale/messages";
import type { Place, SaleStatus, SaleView } from "../../sale/types";

export const SALE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

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
	// One `Set-Cookie` header each; they cannot be joined into one value.
	cookies?: string[];
	body: unknown;
};

// The names and the lives of the two cookies, as flash-be sets them.
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The error codes the fake answers with, and the one status of each, as flash-be does.
const ERROR_STATUS = {
	invalid_user: 400,
	invalid_password: 400,
	invalid_credentials: 401,
	not_authenticated: 401,
	invalid_refresh_token: 401,
	username_taken: 409,
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
	cookies: string[] = [],
): Reply => ({ status, headers, body, cookies });
const refuse = (error: ErrorCode) =>
	reply(ERROR_STATUS[error], errorPayload(error));

// The routes of flash-be that the page can reach, each with its method and path.
export type RouteName =
	| "register"
	| "login"
	| "refresh"
	| "logout"
	| "account"
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
	["register", "POST", /^\/auth\/register$/],
	["login", "POST", /^\/auth\/login$/],
	["refresh", "POST", /^\/auth\/refresh$/],
	["logout", "POST", /^\/auth\/logout$/],
	["account", "GET", /^\/auth\/me$/],
	["currentSale", "GET", /^\/sales\/current$/],
	["sale", "GET", /^\/sales\/(?<saleId>[^/]+)$/],
	["saleEvents", "GET", /^\/sales\/(?<saleId>[^/]+)\/events$/],
	["joinQueue", "POST", /^\/sales\/(?<saleId>[^/]+)\/queue$/],
	["checkPlace", "GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/me$/],
	["placeEvents", "GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/me\/events$/],
	["reserve", "POST", /^\/sales\/(?<saleId>[^/]+)\/reservations$/],
	["confirm", "POST", /^\/sales\/(?<saleId>[^/]+)\/purchases$/],
	["outcome", "GET", /^\/sales\/(?<saleId>[^/]+)\/purchases\/me$/],
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
	// Accounts by name, and one session for each login. The name is the user in everything else.
	const accounts = new Map<string, { password: string; role: "shopper" }>();
	type Session = {
		user: string;
		access: string;
		accessEndsAt: number;
		refresh: string;
		refreshEndsAt: number;
		previous: string | undefined;
	};
	const sessions: Session[] = [];
	let requests = 0;
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
			productId: PRODUCT_ID,
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

	const cookie = (
		name: string,
		value: string,
		path: string,
		maxAgeMs: number,
	) =>
		`${name}=${value}; Path=${path}; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Lax`;
	const cookiesOf = (session: Session) => [
		cookie(ACCESS_COOKIE, session.access, "/", ACCESS_TTL_MS),
		cookie(REFRESH_COOKIE, session.refresh, "/auth", REFRESH_TTL_MS),
	];
	const clearedCookies = () => [
		cookie(ACCESS_COOKIE, "", "/", 0),
		cookie(REFRESH_COOKIE, "", "/auth", 0),
	];
	const cookieValue = (header: string | undefined, name: string) =>
		(header ?? "")
			.split(";")
			.map((part) => part.trim().split("="))
			.find(([key]) => key === name)?.[1];

	function startSession(user: string): Session {
		const session = {
			user,
			access: crypto.randomUUID(),
			accessEndsAt: now() + ACCESS_TTL_MS,
			refresh: crypto.randomUUID(),
			refreshEndsAt: now() + REFRESH_TTL_MS,
			previous: undefined,
		};
		sessions.push(session);
		return session;
	}

	// The name of the shopper whose access cookie is in the header, if it still works.
	function userOf(cookies: string | undefined): string | undefined {
		const token = cookieValue(cookies, ACCESS_COOKIE);
		return sessions.find(
			(session) => session.access === token && session.accessEndsAt > now(),
		)?.user;
	}

	const account = (user: string) => ({ username: user, role: "shopper" });

	function register(body: Record<string, unknown>): Reply {
		const user = cleanUser(String(body.username ?? ""));
		if (user === undefined) return refuse("invalid_user");
		const password = cleanPassword(String(body.password ?? ""));
		if (password === undefined) return refuse("invalid_password");
		if (accounts.has(user)) return refuse("username_taken");
		accounts.set(user, { password, role: "shopper" });
		return reply(201, account(user), {}, cookiesOf(startSession(user)));
	}

	function login(body: Record<string, unknown>): Reply {
		const user = cleanUser(String(body.username ?? ""));
		const known = user === undefined ? undefined : accounts.get(user);
		if (user === undefined || known?.password !== body.password) {
			return refuse("invalid_credentials");
		}
		return reply(200, account(user), {}, cookiesOf(startSession(user)));
	}

	// Trades the refresh token for a new pair. The old one works no more; showing it again ends the login, as flash-be does.
	function refresh(cookies: string | undefined): Reply {
		const token = cookieValue(cookies, REFRESH_COOKIE);
		const session = sessions.find(
			(candidate) => token !== undefined && candidate.refresh === token,
		);
		const replayed = sessions.find(
			(candidate) => token !== undefined && candidate.previous === token,
		);
		if (replayed) sessions.splice(sessions.indexOf(replayed), 1);
		if (!session || session.refreshEndsAt <= now()) {
			return {
				...refuse("invalid_refresh_token"),
				cookies: clearedCookies(),
			};
		}
		session.previous = session.refresh;
		session.refresh = crypto.randomUUID();
		session.access = crypto.randomUUID();
		session.accessEndsAt = now() + ACCESS_TTL_MS;
		session.refreshEndsAt = now() + REFRESH_TTL_MS;
		return reply(200, account(session.user), {}, cookiesOf(session));
	}

	function logout(cookies: string | undefined): Reply {
		const access = cookieValue(cookies, ACCESS_COOKIE);
		const token = cookieValue(cookies, REFRESH_COOKIE);
		for (const session of sessions.filter(
			(candidate) => candidate.access === access || candidate.refresh === token,
		)) {
			sessions.splice(sessions.indexOf(session), 1);
		}
		return reply(200, {}, {}, clearedCookies());
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
		// An account that already exists, made without the page.
		addAccount(user: string, password: string) {
			accounts.set(user, { password, role: "shopper" });
		},
		// The login of every shopper ends, as the passing of 7 days does.
		endLogins() {
			for (const session of sessions) {
				session.accessEndsAt = now() - 1;
				session.refreshEndsAt = now() - 1;
			}
		},
		// Only the short token ends, as the passing of 15 minutes does. The refresh token still works.
		endAccessTokens() {
			for (const session of sessions) session.accessEndsAt = now() - 1;
		},
		userOf,
		requestCount: () => requests,
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
			requests += 1;
			if (unreachable) throw new TypeError("fetch failed");
			const match = matchRoute(method, path);
			if (!match) return refuse("not_found");
			const { name: route, params } = match;
			const cookies = headers.cookie;
			switch (route) {
				case "register":
					return register(body);
				case "login":
					return login(body);
				case "refresh":
					return refresh(cookies);
				case "logout":
					return logout(cookies);
				case "currentSale":
					// Like the real API: a sale that is over is no longer the current sale.
					return sale && view().status !== "ended"
						? reply(200, view())
						: refuse("sale_not_found");
				default:
			}
			if (route === "account") {
				const user = userOf(cookies);
				return user === undefined
					? refuse("not_authenticated")
					: reply(200, account(user));
			}
			if (params.saleId !== SALE_ID || !sale) return refuse("sale_not_found");
			if (route === "sale") return reply(200, view());
			// Everything below is a shopper's own, and the cookie says who the shopper is.
			const user = userOf(cookies);
			if (user === undefined) return refuse("not_authenticated");
			switch (route) {
				case "joinQueue":
					return join(user);
				case "reserve":
					return reserve(user, headers[TICKET_HEADER]);
				case "confirm":
					return confirm(user, String(body.reservationId ?? ""));
				case "outcome":
					return outcome(user);
				default:
					return refuse("not_found");
			}
		},
	};
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;
