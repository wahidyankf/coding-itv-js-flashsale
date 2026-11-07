// The queue routes: a shopper joins the line of a sale, reads the place they hold with their ticket, and may follow that
// place on a live stream. The ticket is the proof of the join. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { QueuePlace } from "../../../../domain/queue.js";
import { type StreamOptions, serveEvents } from "../event-stream.js";
import {
	createGuards,
	type SaleParams,
	shopperOf,
	ticketOf,
} from "./guards.js";
import { createdOrOk, sendError, sendResult } from "./reply.js";

// One event of a shopper's place: whose it is, and the place it now has.
type PlaceEvent = { event: "place"; data: { userId: string } & QueuePlace };

// Registers the queue routes. `stream` paces the place stream.
export function registerQueueRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
): void {
	const { needSession, limit } = createGuards(deps);

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the reply body.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/queue",
		preValidation: limit,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.queue.join(request.params.saleId, shopperOf(request)),
				({ created, user, ticket, place }) =>
					createdOrOk(reply, created).send({ userId: user, ticket, ...place }),
			),
	});

	// The place of the shopper who is logged in, with the ticket that proves the join.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/me",
		preValidation: needSession,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.queue.check(
					request.params.saleId,
					shopperOf(request),
					ticketOf(request),
				),
				({ user, place }) =>
					reply.code(HTTP_STATUS.ok).send({ userId: user, ...place }),
			),
	});

	// The place of the shopper who is logged in, pushed when it changes. The ticket is checked once, when the stream opens.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/me/events",
		preValidation: needSession,
		handler: async (request, reply) => {
			const { saleId } = request.params;
			const username = shopperOf(request);
			const ticket = ticketOf(request);
			const first = await deps.queue.check(saleId, username, ticket);
			if (first.isErr()) return sendError(reply, first.error);
			const { user } = first.value;
			return serveEvents(
				request,
				reply,
				async () => {
					const latest = await deps.queue.check(saleId, username, ticket);
					const place = latest.isOk()
						? latest.value.place
						: ({ state: "absent" } as const);
					return {
						event: "place",
						data: { userId: user, ...place },
					} satisfies PlaceEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});
}
