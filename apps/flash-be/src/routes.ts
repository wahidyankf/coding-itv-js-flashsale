import type { FastifyInstance } from "fastify";
import type { Dependencies } from "./app.js";

// All routes live here, with full paths, so the list is easy to scan.
export function registerRoutes(app: FastifyInstance, deps: Dependencies): void {
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
		return sale ? sale : reply.code(404).send({ error: "sale_not_found" });
	});

	app.get<{ Params: { saleId: string } }>(
		"/sales/:saleId",
		async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			return sale ? sale : reply.code(404).send({ error: "sale_not_found" });
		},
	);

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the x-queue-ticket header.
	app.post<{ Params: { saleId: string }; Body: { userId?: unknown } | null }>(
		"/sales/:saleId/queue",
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
}

const QUEUE_ERROR_STATUS = {
	sale_not_found: 404,
	invalid_user: 400,
	sale_ended: 409,
	sold_out: 409,
	invalid_ticket: 401,
	not_in_queue: 404,
} as const;
