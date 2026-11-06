import {
	ADMIN_AUTH_HEADER,
	ERROR_STATUS,
	type PlaceView,
	routes,
	type SaleView,
	type StreamEvent,
	TICKET_HEADER,
} from "@flash/contract";
import { attemptAsync } from "@flash/typekit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Dependencies } from "../../../application/dependencies.js";
import type { Purchase } from "../../../domain/purchase.js";
import { type StreamOptions, serveEvents } from "./event-stream.js";
import { endpoint, fieldOf, schemaOf } from "./schema.js";

// All routes are registered here, from the route table of @flash/contract. The table says the path, the shape of the
// request and every reply; this file only says what each route does.
export function registerRoutes(
	root: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
	const app = root.withTypeProvider<ZodTypeProvider>();

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
			.code(429)
			.header("retry-after", String(verdict.retryAfterSeconds))
			.send({
				error: "rate_limited",
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
			.send({ error: allowed.error });
	};

	// Public sale reads may be kept for the cache time, by this server and by the client.
	const cacheable = <R extends FastifyReply>(reply: R): R => {
		const ms = deps.sales.cacheMs();
		return ms > 0
			? (reply.header(
					"cache-control",
					`public, max-age=${Math.ceil(ms / 1000)}`,
				) as R)
			: reply;
	};

	app.route({
		...endpoint(routes.health),
		schema: schemaOf(routes.health),
		handler: async () => ({ status: "ok" as const }),
	});

	// Readiness: Postgres and Redis both answer.
	app.route({
		...endpoint(routes.ready),
		schema: schemaOf(routes.ready),
		handler: async (_request, reply) => {
			const database = await attemptAsync(() => deps.checkDatabase(), Error);
			const redis = await attemptAsync(() => deps.checkRedis(), Error);
			if (database.isOk() && redis.isOk()) {
				return reply
					.code(200)
					.send({ status: "ok", checks: { database: "ok", redis: "ok" } });
			}
			return reply.code(503).send({
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
		...endpoint(routes.currentSale),
		schema: schemaOf(routes.currentSale),
		handler: async (_request, reply) => {
			const sale = await deps.sales.current();
			if (!sale) return reply.code(404).send({ error: "sale_not_found" });
			return cacheable(reply).code(200).send(sale.value);
		},
	});

	app.route({
		...endpoint(routes.sale),
		schema: schemaOf(routes.sale),
		handler: async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			if (!sale) return reply.code(404).send({ error: "sale_not_found" });
			return cacheable(reply).code(200).send(sale.value);
		},
	});

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.route({
		...endpoint(routes.saleEvents),
		schema: schemaOf(routes.saleEvents),
		handler: async (request, reply) => {
			const { saleId } = request.params;
			if (!(await deps.sales.byId(saleId))) {
				return reply.code(404).send({ error: "sale_not_found" });
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const sale = await deps.sales.byId(saleId);
					if (!sale) throw new Error("the sale is gone");
					return {
						event: "sale",
						data: sale.value,
					} satisfies SaleEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});

	// A shopper's place, pushed when it changes. The ticket is checked once, when the stream opens.
	app.route({
		...endpoint(routes.placeEvents),
		schema: schemaOf(routes.placeEvents),
		handler: async (request, reply) => {
			const { saleId, userId } = request.params;
			const ticket = request.headers[TICKET_HEADER];
			const first = await deps.queue.check(saleId, userId, ticket);
			if (first.isErr()) {
				return reply
					.code(ERROR_STATUS[first.error])
					.send({ error: first.error });
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
	app.route({
		...endpoint(routes.joinQueue),
		schema: schemaOf(routes.joinQueue),
		preValidation: limit,
		handler: async (request, reply) => {
			const joined = await deps.queue.join(
				request.params.saleId,
				request.body.userId,
			);
			if (joined.isErr()) {
				return reply
					.code(ERROR_STATUS[joined.error])
					.send({ error: joined.error });
			}
			const { created, user, ticket, place } = joined.value;
			return reply
				.code(created ? 201 : 200)
				.send({ userId: user, ticket, ...place });
		},
	});

	app.route({
		...endpoint(routes.checkPlace),
		schema: schemaOf(routes.checkPlace),
		handler: async (request, reply) => {
			const checked = await deps.queue.check(
				request.params.saleId,
				request.params.userId,
				request.headers[TICKET_HEADER],
			);
			if (checked.isErr()) {
				return reply
					.code(ERROR_STATUS[checked.error])
					.send({ error: checked.error });
			}
			return reply
				.code(200)
				.send({ userId: checked.value.user, ...checked.value.place });
		},
	});

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.route({
		...endpoint(routes.reserve),
		schema: schemaOf(routes.reserve),
		preValidation: limit,
		handler: async (request, reply) => {
			const reserved = await deps.reservations.reserve(
				request.params.saleId,
				request.body.userId,
				request.headers[TICKET_HEADER],
			);
			if (reserved.isErr()) {
				return reply
					.code(ERROR_STATUS[reserved.error])
					.send({ error: reserved.error });
			}
			const { created, user, reservationId, expiresAt } = reserved.value;
			return reply.code(created ? 201 : 200).send({
				userId: user,
				reservationId,
				expiresAt: expiresAt.toISOString(),
			});
		},
	});

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.route({
		...endpoint(routes.confirm),
		schema: schemaOf(routes.confirm),
		preValidation: limit,
		handler: async (request, reply) => {
			const confirmed = await deps.purchases.confirm(
				request.params.saleId,
				request.body.userId,
				request.body.reservationId,
			);
			if (confirmed.isErr()) {
				return reply
					.code(ERROR_STATUS[confirmed.error])
					.send({ error: confirmed.error });
			}
			const { created, purchase } = confirmed.value;
			return reply.code(created ? 201 : 200).send(purchaseView(purchase));
		},
	});

	// An operator creates a sale. The window must not overlap another sale.
	app.route({
		...endpoint(routes.createSale),
		schema: schemaOf(routes.createSale),
		// onRequest runs before the body is read, so a client without the token learns nothing from a broken body.
		onRequest: [limitAdmin, authorizeAdmin],
		handler: async (request, reply) => {
			const created = await deps.admin.create(request.body);
			if (created.isErr()) {
				return reply
					.code(ERROR_STATUS[created.error])
					.send({ error: created.error });
			}
			return reply.code(201).send(created.value);
		},
	});

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.route({
		...endpoint(routes.outcome),
		schema: schemaOf(routes.outcome),
		handler: async (request, reply) => {
			const found = await deps.purchases.outcome(
				request.params.saleId,
				request.params.userId,
			);
			if (found.isErr()) {
				return reply
					.code(ERROR_STATUS[found.error])
					.send({ error: found.error });
			}
			const { user, outcome } = found.value;
			if (outcome.state === "purchased") {
				return reply
					.code(200)
					.send({ ...purchaseView(outcome.purchase), state: "purchased" });
			}
			if (outcome.state === "holding") {
				return reply.code(200).send({
					userId: user,
					state: "holding",
					reservationId: outcome.reservationId,
					expiresAt: outcome.expiresAt.toISOString(),
				});
			}
			return reply.code(200).send({ userId: user, state: "none" });
		},
	});
}

type SaleEvent = Extract<StreamEvent, { event: "sale" }> & { data: SaleView };
type PlaceEvent = Extract<StreamEvent, { event: "place" }> & {
	data: PlaceView;
};

function purchaseView(purchase: Purchase) {
	return {
		userId: purchase.user,
		purchaseId: purchase.id,
		reservationId: purchase.reservationId,
		purchasedAt: purchase.purchasedAt.toISOString(),
	};
}
