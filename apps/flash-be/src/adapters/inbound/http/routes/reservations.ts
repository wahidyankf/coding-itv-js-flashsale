// The reservation route: an admitted shopper asks for one item, and the hold keeps it for the hold time. Inbound HTTP
// adapter.
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import {
	createGuards,
	type SaleParams,
	shopperOf,
	ticketOf,
} from "./guards.js";
import { createdOrOk, sendResult } from "./reply.js";

// Registers the reservation route.
export function registerReservationRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	const { limit } = createGuards(deps);

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/reservations",
		preValidation: limit,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.reservations.reserve(
					request.params.saleId,
					shopperOf(request),
					ticketOf(request),
				),
				({ created, user, reservationId, expiresAt }) =>
					createdOrOk(reply, created).send({
						userId: user,
						reservationId,
						expiresAt: expiresAt.toISOString(),
					}),
			),
	});
}
