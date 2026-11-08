// The health routes. `/health` says the process is up. `/ready` says that Postgres and Redis both answer and the process
// is not stopping, which a load balancer checks before it sends traffic. Inbound HTTP adapter.

import { HTTP_STATUS, PROBE_PATHS } from "@flash/flash-commons";
import { attemptAsync, type Result } from "@flash/typekit";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import { ERROR_STATUS } from "../errors.js";

// The word a readiness check reports: "ok" when the store answered, "error" when it did not.
const checkWord = (check: Result<void, Error>): "ok" | "error" =>
	check.isOk() ? "ok" : "error";

// Registers `/health` and `/ready`. The e2e configs and specs depend on both, so their answers are a contract.
// `isStopping` is true once the process was asked to stop; readiness then answers 503 so the balancer moves the traffic.
export function registerHealthRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	isStopping: () => boolean,
): void {
	app.route({
		method: "GET",
		url: PROBE_PATHS.health,
		handler: async () => ({ status: "ok" as const }),
	});

	// Readiness: Postgres and Redis both answer, and the process is not stopping. Both checks run even when one fails or
	// the process stops, so the reply always shows each store.
	app.route({
		method: "GET",
		url: PROBE_PATHS.ready,
		handler: async (_request, reply) => {
			const database = await attemptAsync(() => deps.checkDatabase(), Error);
			const redis = await attemptAsync(() => deps.checkGate(), Error);
			const checks = {
				database: checkWord(database),
				redis: checkWord(redis),
			};
			if (isStopping()) {
				return reply
					.code(ERROR_STATUS.unavailable)
					.send({ status: "stopping", checks });
			}
			if (database.isOk() && redis.isOk()) {
				return reply.code(HTTP_STATUS.ok).send({ status: "ok", checks });
			}
			return reply
				.code(ERROR_STATUS.unavailable)
				.send({ status: "unavailable", checks });
		},
	});
}
