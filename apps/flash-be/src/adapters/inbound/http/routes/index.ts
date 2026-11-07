// The HTTP routes, grouped by area, one file each. This file calls the areas in the order a shopper's visit follows:
// health, the login, the sale, the queue, the hold, the purchase, and then the operator's routes. The paths, what each
// route takes and the replies are in docs/reference/http-endpoints.md. Inbound HTTP adapter.
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { StreamOptions } from "../event-stream.js";
import { registerAdminRoutes } from "./admin.js";
import { registerAuthRoutes } from "./auth.js";
import { registerHealthRoutes } from "./health.js";
import { registerPurchaseRoutes } from "./purchases.js";
import { registerQueueRoutes } from "./queue.js";
import { registerReservationRoutes } from "./reservations.js";
import { registerSaleRoutes } from "./sales.js";

// Registers every route on `app`. `stream` paces the event streams. `cookies.secure` says whether the login cookies may
// only travel over HTTPS; off behind plain HTTP, where a browser would not send them back.
export function registerRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
	cookies: { secure: boolean },
): void {
	registerHealthRoutes(app, deps);
	registerAuthRoutes(app, deps, cookies);
	registerSaleRoutes(app, deps, stream);
	registerQueueRoutes(app, deps, stream);
	registerReservationRoutes(app, deps);
	registerPurchaseRoutes(app, deps);
	registerAdminRoutes(app, deps);
}
