// The health routes. `/health` says the process is up. `/ready` says that Postgres and Redis both answer, which a load
// balancer checks before it sends traffic. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import { attemptAsync, type Result } from "@flash/typekit";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import { ERROR_STATUS } from "../errors.js";

// The word a readiness check reports: "ok" when the store answered, "error" when it did not.
const checkWord = (check: Result<void, Error>): "ok" | "error" =>
	check.isOk() ? "ok" : "error";

// Registers `/health` and `/ready`.
export function registerHealthRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	app.route({
		method: "GET",
		url: "/health",
		handler: async () => ({ status: "ok" as const }),
	});

	// Readiness: Postgres and Redis both answer. The checks are built once, and the reply carries them either way.
	app.route({
		method: "GET",
		url: "/ready",
		handler: async (_request, reply) => {
			const database = await attemptAsync(() => deps.checkDatabase(), Error);
			const redis = await attemptAsync(() => deps.checkGate(), Error);
			const checks = {
				database: checkWord(database),
				redis: checkWord(redis),
			};
			if (database.isOk() && redis.isOk()) {
				return reply.code(HTTP_STATUS.ok).send({ status: "ok", checks });
			}
			return reply
				.code(ERROR_STATUS.unavailable)
				.send({ status: "unavailable", checks });
		},
	});
}
