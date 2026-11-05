import { attemptAsync } from "@flash/typekit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Dependencies } from "../../../application/dependencies.js";
import type { ConfirmError } from "../../../application/purchase-service.js";
import type {
	CheckError,
	JoinError,
} from "../../../application/queue-service.js";
import type { ReserveError } from "../../../application/reservation-service.js";
import type { Purchase } from "../../../domain/purchase.js";
import { type StreamOptions, serveEvents } from "./event-stream.js";

// All routes live here, with full paths, so the list is easy to scan.
export function registerRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
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
		const database = await attemptAsync(() => deps.checkDatabase(), Error);
		const redis = await attemptAsync(() => deps.checkRedis(), Error);
		const checks = {
			database: database.isOk() ? "ok" : "error",
			redis: redis.isOk() ? "ok" : "error",
		};

		const ready = Object.values(checks).every((value) => value === "ok");
		return reply
			.code(ready ? 200 : 503)
			.send({ status: ready ? "ok" : "unavailable", checks });
	});

	// The sale a shopper sees. "current" is the sale that opens last.
	app.get("/sales/current", async (_request, reply) => {
		const sale = await deps.sales.current();
		if (!sale) return reply.code(404).send({ error: "sale_not_found" });
		return cacheable(reply).send(sale.value);
	});

	app.get<{ Params: { saleId: string } }>(
		"/sales/:saleId",
		async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			if (!sale) return reply.code(404).send({ error: "sale_not_found" });
			return cacheable(reply).send(sale.value);
		},
	);

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.get<{ Params: { saleId: string } }>(
		"/sales/:saleId/events",
		async (request, reply) => {
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
					return { event: "sale", data: sale.value };
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	);

	// A shopper's place, pushed when it changes. The ticket is checked once, when the stream opens.
	app.get<{ Params: { saleId: string; userId: string } }>(
		"/sales/:saleId/queue/:userId/events",
		async (request, reply) => {
			const { saleId, userId } = request.params;
			const header = request.headers["x-queue-ticket"];
			const ticket = typeof header === "string" ? header : undefined;
			const first = await deps.queue.check(saleId, userId, ticket);
			if (first.isErr()) {
				return reply
					.code(QUEUE_ERROR_STATUS[first.error])
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
						: { state: "absent" };
					return { event: "place", data: { userId: user, ...place } };
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	);

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the x-queue-ticket header.
	app.post<{ Params: { saleId: string }; Body: { userId?: unknown } | null }>(
		"/sales/:saleId/queue",
		{ preHandler: limit },
		async (request, reply) => {
			const joined = await deps.queue.join(
				request.params.saleId,
				request.body?.userId,
			);
			if (joined.isErr()) {
				return reply
					.code(QUEUE_ERROR_STATUS[joined.error])
					.send({ error: joined.error });
			}
			const { created, user, ticket, place } = joined.value;
			return reply
				.code(created ? 201 : 200)
				.send({ userId: user, ticket, ...place });
		},
	);

	app.get<{ Params: { saleId: string; userId: string } }>(
		"/sales/:saleId/queue/:userId",
		async (request, reply) => {
			const ticket = request.headers["x-queue-ticket"];
			const checked = await deps.queue.check(
				request.params.saleId,
				request.params.userId,
				typeof ticket === "string" ? ticket : undefined,
			);
			if (checked.isErr()) {
				return reply
					.code(QUEUE_ERROR_STATUS[checked.error])
					.send({ error: checked.error });
			}
			return { userId: checked.value.user, ...checked.value.place };
		},
	);

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.post<{ Params: { saleId: string }; Body: { userId?: unknown } | null }>(
		"/sales/:saleId/reservations",
		{ preHandler: limit },
		async (request, reply) => {
			const ticket = request.headers["x-queue-ticket"];
			const reserved = await deps.reservations.reserve(
				request.params.saleId,
				request.body?.userId,
				typeof ticket === "string" ? ticket : undefined,
			);
			if (reserved.isErr()) {
				return reply
					.code(RESERVE_ERROR_STATUS[reserved.error])
					.send({ error: reserved.error });
			}
			const { created, user, reservationId, expiresAt } = reserved.value;
			return reply.code(created ? 201 : 200).send({
				userId: user,
				reservationId,
				expiresAt: expiresAt.toISOString(),
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
			const confirmed = await deps.purchases.confirm(
				request.params.saleId,
				request.body?.userId,
				request.body?.reservationId,
			);
			if (confirmed.isErr()) {
				return reply
					.code(CONFIRM_ERROR_STATUS[confirmed.error])
					.send({ error: confirmed.error });
			}
			const { created, purchase } = confirmed.value;
			return reply.code(created ? 201 : 200).send(purchaseBody(purchase));
		},
	);

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.get<{ Params: { saleId: string; userId: string } }>(
		"/sales/:saleId/purchases/:userId",
		async (request, reply) => {
			const found = await deps.purchases.outcome(
				request.params.saleId,
				request.params.userId,
			);
			if (found.isErr()) {
				return reply
					.code(found.error === "sale_not_found" ? 404 : 400)
					.send({ error: found.error });
			}
			const { user, outcome } = found.value;
			if (outcome.state === "purchased") {
				return { ...purchaseBody(outcome.purchase), state: "purchased" };
			}
			if (outcome.state === "holding") {
				return {
					userId: user,
					state: "holding",
					reservationId: outcome.reservationId,
					expiresAt: outcome.expiresAt.toISOString(),
				};
			}
			return { userId: user, state: "none" };
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
} satisfies Record<ConfirmError, number>;

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
} satisfies Record<ReserveError, number>;

const QUEUE_ERROR_STATUS = {
	sale_not_found: 404,
	invalid_user: 400,
	sale_ended: 409,
	sold_out: 409,
	invalid_ticket: 401,
	not_in_queue: 404,
} satisfies Record<JoinError | CheckError, number>;
