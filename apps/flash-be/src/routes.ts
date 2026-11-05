import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Dependencies } from "./app.js";
import type { Purchase } from "./purchases/purchase-repository.js";

// All routes live here, with full paths, so the list is easy to scan.
export function registerRoutes(app: FastifyInstance, deps: Dependencies): void {
	// Runs before every write route. A client over its limit is told to wait, and the route never runs.
	const limit = async (request: FastifyRequest, reply: FastifyReply) => {
		const body = request.body as { userId?: unknown } | null;
		const verdict = await deps.rateLimiter.check({
			saleId: (request.params as { saleId: string }).saleId,
			user: body?.userId,
			ip: request.ip,
		});
		if (!verdict.limited) return;
		return reply
			.code(429)
			.header("retry-after", String(verdict.retryAfterSeconds))
			.send({
				error: "rate_limited",
				retryAfterSeconds: verdict.retryAfterSeconds,
			});
	};

	// Public sale reads may be kept for the cache time, by this server and by the client.
	const cacheable = (reply: FastifyReply): FastifyReply => {
		const ms = deps.sales.cacheMs();
		return ms > 0
			? reply.header("cache-control", `public, max-age=${Math.ceil(ms / 1000)}`)
			: reply;
	};

	// Liveness: the process is up. It does not check dependencies.
	app.get("/health", async () => ({ status: "ok" }));

	// Readiness: Postgres and Redis both answer.
	app.get("/ready", async (_request, reply) => {
		const checks = { database: "ok", redis: "ok" };

		try {
			await deps.checkDatabase();
		} catch {
			checks.database = "error";
		}

		try {
			await deps.checkRedis();
		} catch {
			checks.redis = "error";
		}

		const ready = Object.values(checks).every((value) => value === "ok");
		return reply
			.code(ready ? 200 : 503)
			.send({ status: ready ? "ok" : "unavailable", checks });
	});

	// The sale a shopper sees. "current" is the sale that opens last.
	app.get("/sales/current", async (_request, reply) => {
		const sale = await deps.sales.current();
		if (!sale) return reply.code(404).send({ error: "sale_not_found" });
		return cacheable(reply).send(sale);
	});

	app.get<{ Params: { saleId: string } }>(
		"/sales/:saleId",
		async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			if (!sale) return reply.code(404).send({ error: "sale_not_found" });
			return cacheable(reply).send(sale);
		},
	);

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the x-queue-ticket header.
	app.post<{ Params: { saleId: string }; Body: { userId?: unknown } | null }>(
		"/sales/:saleId/queue",
		{ preHandler: limit },
		async (request, reply) => {
			const result = await deps.queue.join(
				request.params.saleId,
				request.body?.userId,
			);
			if (!result.ok) {
				return reply
					.code(QUEUE_ERROR_STATUS[result.error])
					.send({ error: result.error });
			}
			return reply.code(result.created ? 201 : 200).send({
				userId: result.user,
				ticket: result.ticket,
				...result.place,
			});
		},
	);

	app.get<{ Params: { saleId: string; userId: string } }>(
		"/sales/:saleId/queue/:userId",
		async (request, reply) => {
			const ticket = request.headers["x-queue-ticket"];
			const result = await deps.queue.check(
				request.params.saleId,
				request.params.userId,
				typeof ticket === "string" ? ticket : undefined,
			);
			if (!result.ok) {
				return reply
					.code(QUEUE_ERROR_STATUS[result.error])
					.send({ error: result.error });
			}
			return { userId: result.user, ...result.place };
		},
	);

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.post<{ Params: { saleId: string }; Body: { userId?: unknown } | null }>(
		"/sales/:saleId/reservations",
		{ preHandler: limit },
		async (request, reply) => {
			const ticket = request.headers["x-queue-ticket"];
			const result = await deps.reservations.reserve(
				request.params.saleId,
				request.body?.userId,
				typeof ticket === "string" ? ticket : undefined,
			);
			if (!result.ok) {
				return reply
					.code(RESERVE_ERROR_STATUS[result.error])
					.send({ error: result.error });
			}
			return reply.code(result.created ? 201 : 200).send({
				userId: result.user,
				reservationId: result.reservationId,
				expiresAt: result.expiresAt.toISOString(),
			});
		},
	);

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.post<{
		Params: { saleId: string };
		Body: { userId?: unknown; reservationId?: unknown } | null;
	}>(
		"/sales/:saleId/purchases",
		{ preHandler: limit },
		async (request, reply) => {
			const result = await deps.purchases.confirm(
				request.params.saleId,
				request.body?.userId,
				request.body?.reservationId,
			);
			if (!result.ok) {
				return reply
					.code(CONFIRM_ERROR_STATUS[result.error])
					.send({ error: result.error });
			}
			return reply
				.code(result.created ? 201 : 200)
				.send(purchaseBody(result.purchase));
		},
	);

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.get<{ Params: { saleId: string; userId: string } }>(
		"/sales/:saleId/purchases/:userId",
		async (request, reply) => {
			const result = await deps.purchases.outcome(
				request.params.saleId,
				request.params.userId,
			);
			if (!result.ok) {
				return reply
					.code(result.error === "sale_not_found" ? 404 : 400)
					.send({ error: result.error });
			}
			const { outcome } = result;
			if (outcome.state === "purchased") {
				return { ...purchaseBody(outcome.purchase), state: "purchased" };
			}
			if (outcome.state === "holding") {
				return {
					userId: result.user,
					state: "holding",
					reservationId: outcome.reservationId,
					expiresAt: outcome.expiresAt.toISOString(),
				};
			}
			return { userId: result.user, state: "none" };
		},
	);
}

function purchaseBody(purchase: Purchase) {
	return {
		userId: purchase.user,
		purchaseId: purchase.id,
		reservationId: purchase.reservationId,
		purchasedAt: purchase.purchasedAt.toISOString(),
	};
}

const CONFIRM_ERROR_STATUS = {
	sale_not_found: 404,
	invalid_user: 400,
	invalid_reservation: 400,
	reservation_not_found: 404,
	hold_expired: 409,
	already_purchased: 409,
	sale_ended: 409,
	sold_out: 409,
	payment_failed: 402,
} as const;

const RESERVE_ERROR_STATUS = {
	sale_not_found: 404,
	invalid_user: 400,
	invalid_ticket: 401,
	not_admitted: 403,
	sale_not_started: 409,
	sale_ended: 409,
	sold_out: 409,
	already_purchased: 409,
	unavailable: 503,
} as const;

const QUEUE_ERROR_STATUS = {
	sale_not_found: 404,
	invalid_user: 400,
	sale_ended: 409,
	sold_out: 409,
	invalid_ticket: 401,
	not_in_queue: 404,
} as const;
