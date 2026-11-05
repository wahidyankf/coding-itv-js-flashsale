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

const reply = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Reply => ({ status, headers, body });
const refuse = (status: number, error: string) => reply(status, { error });

// A small stand-in for flash-be that follows its rules for status codes, errors and what a shopper sees, but keeps
// everything in memory. The unit scenarios call it directly. The integration scenarios put an HTTP server in front of
// it. Time comes from `now`, so a scenario can move it.
export function createFakeBackend(now: () => number) {
	let sale: SaleSpec | undefined;
	let unreachable = false;
	const bought = new Map<string, string>();
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
					429,
					{ error: "rate_limited", retryAfterSeconds: 30 },
					{ "retry-after": "30" },
				)
			: undefined;
	}

	const USER = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

	function join(user: string): Reply {
		const wait = limited(user);
		if (wait) return wait;
		if (!sale) return refuse(404, "sale_not_found");
		if (!USER.test(user)) return refuse(400, "invalid_user");
		const state = status();
		if (state === "ended") return refuse(409, "sale_ended");
		if (state === "sold_out") return refuse(409, "sold_out");
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
		if (!sale) return refuse(404, "sale_not_found");
		if (!USER.test(user)) return refuse(400, "invalid_user");
		const state = status();
		if (state === "upcoming") return refuse(409, "sale_not_started");
		if (state === "ended") return refuse(409, "sale_ended");
		if (state === "sold_out") return refuse(409, "sold_out");
		if (ticket !== ticketOf(user)) return refuse(401, "invalid_ticket");
		if (!admitted.has(user)) return refuse(403, "not_admitted");
		if (bought.has(user)) return refuse(409, "already_purchased");
		const own = holds.get(user);
		if (own && own.expiresAt > now()) {
			return reply(200, {
				userId: user,
				reservationId: own.reservationId,
				expiresAt: new Date(own.expiresAt).toISOString(),
			});
		}
		if (bought.size + liveHolds() >= (sale?.stock ?? 0)) {
			return refuse(409, "sold_out");
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
		if (!sale) return refuse(404, "sale_not_found");
		const earlier = bought.get(user);
		if (earlier) return reply(200, { userId: user, purchaseId: earlier });
		const hold = holds.get(user);
		if (!hold || hold.reservationId !== reservationId) {
			return refuse(404, "reservation_not_found");
		}
		if (hold.expiresAt <= now()) return refuse(409, "hold_expired");
		if (settings.paymentDeclines) return refuse(402, "payment_failed");
		const purchaseId = crypto.randomUUID();
		bought.set(user, purchaseId);
		holds.delete(user);
		sale.sold += 1;
		changed();
		return reply(201, { userId: user, purchaseId });
	}

	function outcome(user: string): Reply {
		if (!sale) return refuse(404, "sale_not_found");
		const purchase = bought.get(user);
		if (purchase) {
			return reply(200, {
				userId: user,
				purchaseId: purchase,
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
			bought.set(user, crypto.randomUUID());
			if (sale) sale.sold += 1;
			changed();
		},
		view,
		placeOf,
		hasSale: () => sale !== undefined,
		// The API.
		handle(
			method: string,
			path: string,
			headers: Record<string, string | undefined>,
			body: Record<string, unknown>,
		): Reply {
			if (unreachable) throw new TypeError("fetch failed");
			if (path === "current") {
				return sale ? reply(200, view()) : refuse(404, "sale_not_found");
			}
			const parts = path.split("/");
			const [id, section, user] = parts;
			if (id !== SALE_ID || !sale) return refuse(404, "sale_not_found");
			if (method === "GET" && section === undefined) return reply(200, view());
			const name = String(body.userId ?? user ?? "")
				.trim()
				.toLowerCase();
			if (method === "POST" && section === "queue") return join(name);
			if (method === "POST" && section === "reservations") {
				return reserve(name, headers["x-queue-ticket"]);
			}
			if (method === "POST" && section === "purchases") {
				return confirm(name, String(body.reservationId ?? ""));
			}
			if (method === "GET" && section === "purchases" && user !== undefined) {
				return outcome(decodeURIComponent(user));
			}
			return refuse(404, "not_found");
		},
	};
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;
