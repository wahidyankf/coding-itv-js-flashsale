// The sale routes: the sale a shopper sees now, one sale by its id, and the live stream of one sale. The public reads may
// be kept for the cache time, by this server and by the client. Inbound HTTP adapter.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { SaleView } from "../../../../application/sale-view.js";
import { MS_PER_SECOND } from "../../../../domain/time.js";
import { HTTP_STATUS } from "../errors.js";
import { type StreamOptions, serveEvents } from "../event-stream.js";
import type { SaleParams } from "./guards.js";
import { sendError } from "./reply.js";

// One event of a sale's stream: the sale as it is now.
type SaleEvent = { event: "sale"; data: SaleView };

// Registers the sale routes. `stream` paces the live stream.
export function registerSaleRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
	// Public sale reads may be kept for the cache time. Zero means no cache header at all.
	const cacheable = <R extends FastifyReply>(reply: R): R => {
		const ms = deps.sales.cacheMs();
		return ms > 0
			? (reply.header(
					"cache-control",
					`public, max-age=${Math.ceil(ms / MS_PER_SECOND)}`,
				) as R)
			: reply;
	};
	// The reply to a sale read: the sale, or the not-found reply when there is none.
	const sendSale = (reply: FastifyReply, sale: SaleView | undefined) =>
		sale === undefined
			? sendError(reply, "sale_not_found")
			: cacheable(reply).code(HTTP_STATUS.ok).send(sale);

	// The sale a shopper sees. "current" is the running sale, else the one that opens next, else none.
	app.route({
		method: "GET",
		url: "/sales/current",
		handler: async (_request, reply) =>
			sendSale(reply, await deps.sales.current()),
	});

	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId",
		handler: async (request, reply) =>
			sendSale(reply, await deps.sales.byId(request.params.saleId)),
	});

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/events",
		handler: async (request, reply) => {
			const { saleId } = request.params;
			if ((await deps.sales.byId(saleId)) === undefined) {
				return sendError(reply, "sale_not_found");
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const sale = await deps.sales.byId(saleId);
					// A sale that is gone has nothing to tell. The stream stays open and sends nothing for it.
					return sale === undefined
						? undefined
						: ({ event: "sale", data: sale } satisfies SaleEvent);
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});
}
