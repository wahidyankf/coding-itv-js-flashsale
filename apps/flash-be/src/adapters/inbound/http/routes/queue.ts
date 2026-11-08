// The queue routes: a shopper joins the line of a sale, reads the place they hold with their ticket, and may follow that
// place on a live stream. The ticket is the proof of the join. Inbound HTTP adapter.

import { API_PATHS, HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { QueuePlace } from "../../../../domain/queue.js";
import type { Username } from "../../../../domain/user.js";
import { type StreamContext, serveEvents } from "../event-stream.js";
import {
	createGuards,
	type SaleParams,
	shopperOf,
	ticketOf,
} from "./guards.js";
import { createdOrOk, sendError, sendResult } from "./reply.js";

// A shopper's place as the wire carries it: whose it is, then the place it has.
const placeBody = (user: Username, place: QueuePlace) => ({
	userId: user,
	...place,
});

// One event of a shopper's place: whose it is, and the place it now has.
type PlaceEvent = { event: "place"; data: ReturnType<typeof placeBody> };

// Registers the queue routes. The shopper is the one who is logged in (the `queueMe` paths), and `stream` paces the place stream.
export function registerQueueRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	stream: StreamContext,
): void {
	const { needSession, limit } = createGuards(deps);

	// Joins the shopper to the queue. The ticket in the reply proves the join, and later reads check it.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: API_PATHS.queue,
		preValidation: limit,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.queue.join(request.params.saleId, shopperOf(request)),
				// The ticket sits between the user and the place, which keeps the key order of the reply.
				({ created, user, ticket, place }) =>
					createdOrOk(reply, created).send({ userId: user, ticket, ...place }),
			),
	});

	// The place of the shopper who is logged in, with the ticket that proves the join.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: API_PATHS.queueMe,
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
					reply.code(HTTP_STATUS.ok).send(placeBody(user, place)),
			),
	});

	// Pushes the shopper's place when it changes. The first check runs before the stream opens, so a bad ticket gets a normal
	// reply. A place that is already lost is not a bad request: the stream opens and its first event says the place is
	// absent, as a later loss does. A `404` here would reach the page as a refusal, which it never retries or shows.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: API_PATHS.queueMeEvents,
		preValidation: needSession,
		handler: async (request, reply) => {
			const { saleId } = request.params;
			const user = shopperOf(request);
			const ticket = ticketOf(request);
			const first = await deps.queue.check(saleId, user, ticket);
			if (first.isErr() && first.error !== "not_in_queue") {
				return sendError(reply, first.error);
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const latest = await deps.queue.check(saleId, user, ticket);
					const place = latest.isOk()
						? latest.value.place
						: ({ state: "absent" } as const);
					return {
						event: "place",
						data: placeBody(user, place),
					} satisfies PlaceEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});
}
