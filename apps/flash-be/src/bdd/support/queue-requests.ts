// The requests every layer sends the same way: the queue, the reserve, the purchase, the public sale reads and the
// limit scenarios. Each one reads the sale the scenario is on when the request is sent, and records the reply.
import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
	QueueScenario,
	Response,
	ShopScenario,
} from "./queue-scenario.js";

// The key a shopper has in the scenario's maps: the name as the server normalizes it.
export const shopperKey = (user: string): string => user.trim().toLowerCase();

// The queue ticket header, when the scenario has a ticket to send.
export const ticketHeader = (
	ticket: string | undefined,
): Record<string, string> =>
	ticket === undefined ? {} : { "x-queue-ticket": ticket };

// An address of the scenario's own. The rate counters of the integration layer live in the shared Redis, so a scenario
// that counts by address must not share its address with the scenarios before it.
const scenarioAddress = () =>
	`10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

// The requests every layer sends the same way. `saleId` is read when the request is sent.
export function queueRequests(app: FastifyInstance, scenario: QueueScenario) {
	const address = scenarioAddress();
	return {
		async tryLogin(user: string): Promise<Response> {
			scenario.response = await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				remoteAddress: address,
				payload: { username: user, password: "not the password" },
			});
			return scenario.response;
		},
		async join(user: string, saleId = scenario.saleId): Promise<Response> {
			const reply = await app.inject({
				method: "POST",
				url: `/api/v1/sales/${saleId}/queue`,
				headers: { cookie: await scenario.login(user) },
			});
			scenario.response = reply;
			const ticket = reply.json().ticket;
			const key = shopperKey(user);
			if (ticket && !scenario.tickets.has(key)) {
				scenario.tickets.set(key, ticket);
			}
			return reply;
		},
		async check(user: string, ticket?: string): Promise<Response> {
			scenario.response = await app.inject({
				method: "GET",
				url: `/api/v1/sales/${scenario.saleId}/queue/me`,
				headers: {
					cookie: await scenario.login(user),
					...ticketHeader(ticket),
				},
			});
			return scenario.response;
		},
	};
}

// The reserve request, the same at every layer.
export function reserveRequests(app: FastifyInstance, scenario: ShopScenario) {
	const send = async (
		user: string,
		options: { ticket?: string; saleId?: string } = {},
	): Promise<Response> => {
		const key = shopperKey(user);
		const ticket = options.ticket ?? scenario.tickets.get(key);
		const reply = await app.inject({
			method: "POST",
			url: `/api/v1/sales/${options.saleId ?? scenario.saleId}/reservations`,
			headers: {
				cookie: await scenario.login(user),
				...ticketHeader(ticket),
			},
		});
		scenario.response = reply;
		if (
			(reply.statusCode === 201 || reply.statusCode === 200) &&
			!scenario.holds.has(key)
		) {
			scenario.holds.set(key, reply.json());
		}
		return reply;
	};
	return {
		reserve: send,
		reserveAll: (users: string[]) =>
			Promise.all(users.map((user) => send(user))),
	};
}

// The purchase requests, the same at every layer.
export function purchaseRequests(app: FastifyInstance, scenario: ShopScenario) {
	let pending: Promise<Response> | undefined;
	const send = async (
		user: string,
		options: { reservationId?: string; saleId?: string; owner?: string } = {},
	): Promise<Response> => {
		const key = shopperKey(user);
		const owner = shopperKey(options.owner ?? user);
		const reservationId =
			options.reservationId ?? scenario.holds.get(owner)?.reservationId;
		const reply = await app.inject({
			method: "POST",
			url: `/api/v1/sales/${options.saleId ?? scenario.saleId}/purchases`,
			headers: { cookie: await scenario.login(user) },
			payload: { reservationId },
		});
		scenario.response = reply;
		if (
			(reply.statusCode === 201 || reply.statusCode === 200) &&
			!scenario.purchases.has(key)
		) {
			scenario.purchases.set(key, reply.json());
		}
		return reply;
	};
	return {
		confirm: send,
		async startConfirm(user: string) {
			pending = send(user);
		},
		async finishConfirm() {
			if (!pending) throw new Error("no confirmation was started");
			scenario.response = await pending;
		},
		confirmAllHolders: (users: string[]) =>
			Promise.all(
				users
					.filter((user) => scenario.holds.has(user))
					.map((user) => send(user)),
			),
		async outcome(user: string, saleId = scenario.saleId) {
			scenario.response = await app.inject({
				method: "GET",
				url: `/api/v1/sales/${saleId}/purchases/me`,
				headers: { cookie: await scenario.login(user) },
			});
			return scenario.response;
		},
		async saleView() {
			const reply = await app.inject({
				method: "GET",
				url: `/api/v1/sales/${scenario.saleId}`,
			});
			return reply.json();
		},
	};
}

// The public sale reads, the same at every layer.
export function saleRequests(app: FastifyInstance, scenario: ShopScenario) {
	return {
		async readSale() {
			scenario.response = await app.inject({
				method: "GET",
				url: `/api/v1/sales/${scenario.saleId}`,
			});
			return scenario.response;
		},
		async readCurrentSale() {
			scenario.response = await app.inject({
				method: "GET",
				url: "/api/v1/sales/current",
			});
			return scenario.response;
		},
	};
}

// Write requests by the name a scenario uses for them, for the rate limit scenarios.
export function limitRequests(scenario: ShopScenario) {
	const send = async (kind: string, user: string): Promise<Response> => {
		if (kind === "join the queue") return scenario.join(user);
		if (kind === "reserve an item") return scenario.reserve(user);
		if (kind === "confirm a purchase") {
			return scenario.confirm(user, { reservationId: "not-an-id" });
		}
		if (kind === "log in") return scenario.tryLogin(user);
		throw new Error(`unknown request "${kind}"`);
	};
	return {
		async repeat(kind: string, user: string, times: number) {
			scenario.replies = [];
			for (let attempt = 0; attempt < times; attempt++) {
				scenario.replies.push(await send(kind, user));
			}
			return scenario.replies;
		},
		async joinMany(count: number) {
			scenario.replies = [];
			for (let index = 0; index < count; index++) {
				scenario.replies.push(await scenario.join(`visitor${index}`));
			}
			return scenario.replies;
		},
	};
}
