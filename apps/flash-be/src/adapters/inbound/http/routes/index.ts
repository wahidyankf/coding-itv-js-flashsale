// The HTTP routes, one file per area. The order follows a shopper's visit, ending with the operator's routes. The paths,
// inputs and replies are in docs/reference/http-endpoints.md. Inbound HTTP adapter.
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { StreamContext } from "../event-stream.js";
import { registerAdminRoutes } from "./admin.js";
import { registerAuthRoutes } from "./auth.js";
import { registerHealthRoutes } from "./health.js";
import { registerPurchaseRoutes } from "./purchases.js";
import { registerQueueRoutes } from "./queue.js";
import { registerReservationRoutes } from "./reservations.js";
import { registerSaleRoutes } from "./sales.js";

// Registers every route on `app`. `stream` paces the event streams and holds the open ones. `edge.secure` says whether the
// login cookies may only travel over HTTPS; off behind plain HTTP, where a browser would not send them back.
// `edge.isStopping` turns readiness to 503 once the process was asked to stop.
export function registerRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamContext,
	edge: { secure: boolean; isStopping: () => boolean },
): void {
	registerHealthRoutes(app, deps, edge.isStopping);
	registerAuthRoutes(app, deps, { secure: edge.secure });
	registerSaleRoutes(app, deps, stream);
	registerQueueRoutes(app, deps, stream);
	registerReservationRoutes(app, deps);
	registerPurchaseRoutes(app, deps);
	registerAdminRoutes(app, deps);
}
