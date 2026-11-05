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
}
