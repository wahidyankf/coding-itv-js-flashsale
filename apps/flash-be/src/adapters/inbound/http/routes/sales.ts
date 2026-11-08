// The sale routes: the sale a shopper sees now, one sale by its id, and the live stream of one sale. The public reads may
// be kept for the cache time, by this server and by the client. Inbound HTTP adapter.

import { API_PATHS, HTTP_STATUS, MS_PER_SECOND } from "@flash/flash-commons";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { SaleWithStatus } from "../../../../application/sale-service.js";
import { type StreamOptions, serveEvents } from "../event-stream.js";
import { describeSale, type SaleView } from "../sale-view.js";
import type { SaleParams } from "./guards.js";
import { sendError } from "./reply.js";

// One event of a sale's stream: the sale as it is now.
type SaleEvent = { event: "sale"; data: SaleView };

// Registers the public sale routes: the current sale, one sale, and its live stream. None needs a login. `stream` paces the
// live stream.
export function registerSaleRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
	// Public sale reads may be kept for the cache time. Zero means no cache header at all. The time is read from the cache
	// the composition set, so the header and the reads agree.
	const cacheable = (reply: FastifyReply): FastifyReply => {
		const ms = deps.saleCache.ttlMs;
		return ms > 0
			? reply.header(
					"cache-control",
					`public, max-age=${Math.ceil(ms / MS_PER_SECOND)}`,
				)
			: reply;
	};
	// The reply to a sale read: the sale, or the not-found reply when there is none.
	const sendSale = (reply: FastifyReply, found: SaleWithStatus | undefined) =>
		found === undefined
			? sendError(reply, "sale_not_found")
			: cacheable(reply)
					.code(HTTP_STATUS.ok)
					.send(describeSale(found.sale, found.status));

	// The sale a shopper sees. "current" is the running sale, else the one that opens next, else none.
	app.route({
		method: "GET",
		url: API_PATHS.saleCurrent,
		handler: async (_request, reply) =>
			sendSale(reply, await deps.sales.current()),
	});

	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: API_PATHS.sale,
		handler: async (request, reply) =>
			sendSale(reply, await deps.sales.byId(request.params.saleId)),
	});

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: API_PATHS.saleEvents,
		handler: async (request, reply) => {
			const { saleId } = request.params;
			if ((await deps.sales.byId(saleId)) === undefined) {
				return sendError(reply, "sale_not_found");
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const found = await deps.sales.byId(saleId);
					// A sale that is gone has nothing to tell. The stream stays open and sends nothing for it.
					return found === undefined
						? undefined
						: ({
								event: "sale",
								data: describeSale(found.sale, found.status),
							} satisfies SaleEvent);
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});
}
