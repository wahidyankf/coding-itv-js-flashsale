import { attemptAsync } from "@flash/typekit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Dependencies } from "../../../application/dependencies.js";
import type { SaleView } from "../../../application/sale-view.js";
import type { Purchase } from "../../../domain/purchase.js";
import type { QueuePlace } from "../../../domain/queue.js";
import type { SaleDraft } from "../../../domain/sale-window.js";
import { MS_PER_SECOND } from "../../../domain/time.js";
import {
	ADMIN_AUTH_HEADER,
	ERROR_STATUS,
	errorPayload,
	HTTP_STATUS,
	TICKET_HEADER,
} from "./errors.js";
import { type StreamOptions, serveEvents } from "./event-stream.js";

type SaleParams = { saleId: string };
type PlaceParams = { saleId: string; userId: string };

// The ticket is one header; anything else is the same as no ticket.
const ticketOf = (request: Pick<FastifyRequest, "headers">) => {
	const ticket = request.headers[TICKET_HEADER];
	return typeof ticket === "string" ? ticket : undefined;
};

// A field of a value that has not been checked yet, such as a body.
const fieldOf = (source: unknown, name: string): unknown =>
	typeof source === "object" && source !== null && name in source
		? Reflect.get(source, name)
		: undefined;

// A body field that is missing or not a string is refused with the code of that field, before anything else is looked at.
const FIELD_ERROR = {
	userId: "invalid_user",
	reservationId: "invalid_reservation",
} as const;
const missingField = (
	body: unknown,
	fields: ReadonlyArray<keyof typeof FIELD_ERROR>,
) => fields.find((name) => typeof fieldOf(body, name) !== "string");

// A sale to create, if the body has the right types. Whether the values make a usable sale is the rule of the domain.
function saleDraftOf(body: unknown): SaleDraft | undefined {
	const field = (name: string) => fieldOf(body, name);
	const optional = (name: string, type: "string" | "number") =>
		field(name) === undefined || typeof field(name) === type;
	const name = field("name");
	const stock = field("stock");
	const startsAt = field("startsAt");
	const endsAt = field("endsAt");
	const holdSeconds = field("holdSeconds");
	const admitPerSecond = field("admitPerSecond");
	if (
		typeof stock !== "number" ||
		typeof startsAt !== "string" ||
		typeof endsAt !== "string" ||
		!optional("name", "string") ||
		!optional("holdSeconds", "number") ||
		!optional("admitPerSecond", "number")
	) {
		return undefined;
	}
	return {
		name: name as string | undefined,
		stock,
		startsAt,
		endsAt,
		holdSeconds: holdSeconds as number | undefined,
		admitPerSecond: admitPerSecond as number | undefined,
	};
}

// All routes are registered here. The paths, what each route takes and the replies are in docs/reference/http-endpoints.md.
export function registerRoutes(
	root: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
	const app = root;

	// Runs before the body is checked, so a bad request is counted too. A client over its limit is told to wait, and
	// the route never runs.
	const limit = async (
		request: Pick<FastifyRequest, "body" | "ip"> & {
			params: { saleId: string };
		},
		reply: FastifyReply,
	) => {
		return tellToWait(
			reply,
			await deps.rateLimiter.check({
				saleId: request.params.saleId,
				user: fieldOf(request.body, "userId"),
				ip: request.ip,
			}),
		);
	};

	const tellToWait = (
		reply: FastifyReply,
		verdict: Awaited<ReturnType<Dependencies["rateLimiter"]["check"]>>,
	) => {
		if (!verdict.limited) return;
		return reply
			.code(ERROR_STATUS.rate_limited)
			.header("retry-after", String(verdict.retryAfterSeconds))
			.send({
				...errorPayload("rate_limited"),
				retryAfterSeconds: verdict.retryAfterSeconds,
			});
	};

	// The admin routes count by address only, and before the token is read, so a guess is counted too.
	const limitAdmin = async (
		request: Pick<FastifyRequest, "ip">,
		reply: FastifyReply,
	) =>
		tellToWait(
			reply,
			await deps.rateLimiter.check({
				saleId: "admin",
				user: undefined,
				ip: request.ip,
			}),
		);

	// No token in the settings means the route is not there; a wrong token is refused.
	const authorizeAdmin = async (
		request: Pick<FastifyRequest, "headers">,
		reply: FastifyReply,
	) => {
		const allowed = deps.admin.authorize(request.headers[ADMIN_AUTH_HEADER]);
		if (allowed.isOk()) return;
		return reply
			.code(ERROR_STATUS[allowed.error])
			.send(errorPayload(allowed.error));
	};

	// Public sale reads may be kept for the cache time, by this server and by the client.
	const cacheable = <R extends FastifyReply>(reply: R): R => {
		const ms = deps.sales.cacheMs();
		return ms > 0
			? (reply.header(
					"cache-control",
					`public, max-age=${Math.ceil(ms / MS_PER_SECOND)}`,
				) as R)
			: reply;
	};

	app.route({
		method: "GET",
		url: "/health",
		handler: async () => ({ status: "ok" as const }),
	});

	// Readiness: Postgres and Redis both answer.
	app.route({
		method: "GET",
		url: "/ready",
		handler: async (_request, reply) => {
			const database = await attemptAsync(() => deps.checkDatabase(), Error);
			const redis = await attemptAsync(() => deps.checkRedis(), Error);
			if (database.isOk() && redis.isOk()) {
				return reply
					.code(HTTP_STATUS.ok)
					.send({ status: "ok", checks: { database: "ok", redis: "ok" } });
			}
			return reply.code(ERROR_STATUS.unavailable).send({
				status: "unavailable",
				checks: {
					database: database.isOk() ? "ok" : "error",
					redis: redis.isOk() ? "ok" : "error",
				},
			});
		},
	});

	// The sale a shopper sees. "current" is the sale that opens last.
	app.route({
		method: "GET",
		url: "/sales/current",
		handler: async (_request, reply) => {
			const sale = await deps.sales.current();
			if (!sale)
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			return cacheable(reply).code(HTTP_STATUS.ok).send(sale);
		},
	});

	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId",
		handler: async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			if (!sale)
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			return cacheable(reply).code(HTTP_STATUS.ok).send(sale);
		},
	});

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/events",
		handler: async (request, reply) => {
			const { saleId } = request.params;
			if (!(await deps.sales.byId(saleId))) {
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const sale = await deps.sales.byId(saleId);
					if (!sale) throw new Error("the sale is gone");
					return {
						event: "sale",
						data: sale,
					} satisfies SaleEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});

	// A shopper's place, pushed when it changes. The ticket is checked once, when the stream opens.
	app.route<{ Params: PlaceParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/:userId/events",
		handler: async (request, reply) => {
			const { saleId, userId } = request.params;
			const ticket = ticketOf(request);
			const first = await deps.queue.check(saleId, userId, ticket);
			if (first.isErr()) {
				return reply
					.code(ERROR_STATUS[first.error])
					.send(errorPayload(first.error));
			}
			const { user } = first.value;
			return serveEvents(
				request,
				reply,
				async () => {
					const latest = await deps.queue.check(saleId, userId, ticket);
					const place = latest.isOk()
						? latest.value.place
						: ({ state: "absent" } as const);
					return {
						event: "place",
						data: { userId: user, ...place },
					} satisfies PlaceEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the reply body.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/queue",
		preValidation: limit,
		handler: async (request, reply) => {
			if (missingField(request.body, ["userId"])) {
				return reply
					.code(ERROR_STATUS.invalid_user)
					.send(errorPayload("invalid_user"));
			}
			const joined = await deps.queue.join(
				request.params.saleId,
				fieldOf(request.body, "userId"),
			);
			if (joined.isErr()) {
				return reply
					.code(ERROR_STATUS[joined.error])
					.send(errorPayload(joined.error));
			}
			const { created, user, ticket, place } = joined.value;
			return reply
				.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok)
				.send({ userId: user, ticket, ...place });
		},
	});

	app.route<{ Params: PlaceParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/:userId",
		handler: async (request, reply) => {
			const checked = await deps.queue.check(
				request.params.saleId,
				request.params.userId,
				ticketOf(request),
			);
			if (checked.isErr()) {
				return reply
					.code(ERROR_STATUS[checked.error])
					.send(errorPayload(checked.error));
			}
			return reply
				.code(HTTP_STATUS.ok)
				.send({ userId: checked.value.user, ...checked.value.place });
		},
	});

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/reservations",
		preValidation: limit,
		handler: async (request, reply) => {
			if (missingField(request.body, ["userId"])) {
				return reply
					.code(ERROR_STATUS.invalid_user)
					.send(errorPayload("invalid_user"));
			}
			const reserved = await deps.reservations.reserve(
				request.params.saleId,
				fieldOf(request.body, "userId"),
				ticketOf(request),
			);
			if (reserved.isErr()) {
				return reply
					.code(ERROR_STATUS[reserved.error])
					.send(errorPayload(reserved.error));
			}
			const { created, user, reservationId, expiresAt } = reserved.value;
			return reply.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok).send({
				userId: user,
				reservationId,
				expiresAt: expiresAt.toISOString(),
			});
		},
	});

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/purchases",
		preValidation: limit,
		handler: async (request, reply) => {
			const bad = missingField(request.body, ["userId", "reservationId"]);
			if (bad) {
				return reply
					.code(ERROR_STATUS[FIELD_ERROR[bad]])
					.send(errorPayload(FIELD_ERROR[bad]));
			}
			const confirmed = await deps.purchases.confirm(
				request.params.saleId,
				fieldOf(request.body, "userId"),
				fieldOf(request.body, "reservationId"),
			);
			if (confirmed.isErr()) {
				return reply
					.code(ERROR_STATUS[confirmed.error])
					.send(errorPayload(confirmed.error));
			}
			const { created, purchase } = confirmed.value;
			return reply
				.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok)
				.send(purchaseView(purchase));
		},
	});

	// An operator creates a sale. The window must not overlap another sale.
	app.route({
		method: "POST",
		url: "/admin/sales",
		// onRequest runs before the body is read, so a client without the token learns nothing from a broken body.
		onRequest: [limitAdmin, authorizeAdmin],
		handler: async (request, reply) => {
			const draft = saleDraftOf(request.body);
			if (draft === undefined) {
				return reply
					.code(ERROR_STATUS.invalid_sale)
					.send(errorPayload("invalid_sale"));
			}
			const created = await deps.admin.create(draft);
			if (created.isErr()) {
				return reply
					.code(ERROR_STATUS[created.error])
					.send(errorPayload(created.error));
			}
			return reply.code(HTTP_STATUS.created).send(created.value);
		},
	});

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.route<{ Params: PlaceParams }>({
		method: "GET",
		url: "/sales/:saleId/purchases/:userId",
		handler: async (request, reply) => {
			const found = await deps.purchases.outcome(
				request.params.saleId,
				request.params.userId,
			);
			if (found.isErr()) {
				return reply
					.code(ERROR_STATUS[found.error])
					.send(errorPayload(found.error));
			}
			const { user, outcome } = found.value;
			if (outcome.state === "purchased") {
				return reply
					.code(HTTP_STATUS.ok)
					.send({ ...purchaseView(outcome.purchase), state: "purchased" });
			}
			if (outcome.state === "holding") {
				return reply.code(HTTP_STATUS.ok).send({
					userId: user,
					state: "holding",
					reservationId: outcome.reservationId,
					expiresAt: outcome.expiresAt.toISOString(),
				});
			}
			return reply.code(HTTP_STATUS.ok).send({ userId: user, state: "none" });
		},
	});
}

type SaleEvent = { event: "sale"; data: SaleView };
type PlaceEvent = { event: "place"; data: { userId: string } & QueuePlace };

function purchaseView(purchase: Purchase) {
	return {
		userId: purchase.user,
		purchaseId: purchase.id,
		reservationId: purchase.reservationId,
		purchasedAt: purchase.purchasedAt.toISOString(),
	};
}
