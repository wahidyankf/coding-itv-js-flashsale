// The purchase routes: a shopper pays for the item their hold keeps, and asks "did I get it?". Inbound HTTP adapter.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { Outcome, Purchase } from "../../../../domain/purchase.js";
import type { Username } from "../../../../domain/user.js";
import { HTTP_STATUS } from "../errors.js";
import { fieldOf, missingFieldError } from "./bodies.js";
import { createGuards, type SaleParams, shopperOf } from "./guards.js";
import { createdOrOk, sendError, sendResult } from "./reply.js";

// A purchase on the wire: its buyer, its id, the hold it was paid with, and when it was paid.
function purchaseView(purchase: Purchase) {
	return {
		userId: purchase.user,
		purchaseId: purchase.id,
		reservationId: purchase.reservationId,
		purchasedAt: purchase.purchasedAt.toISOString(),
	};
}

// The "did I get it?" reply for each outcome. The switch names every state, so a new state is a type error here until its
// reply is written.
function outcomeReply(
	reply: FastifyReply,
	user: Username,
	outcome: Outcome,
): FastifyReply {
	switch (outcome.state) {
		case "purchased":
			return reply
				.code(HTTP_STATUS.ok)
				.send({ ...purchaseView(outcome.purchase), state: "purchased" });
		case "holding":
			return reply.code(HTTP_STATUS.ok).send({
				userId: user,
				state: "holding",
				reservationId: outcome.reservationId,
				expiresAt: outcome.expiresAt.toISOString(),
			});
		case "none":
			return reply.code(HTTP_STATUS.ok).send({ userId: user, state: "none" });
	}
}

// Registers the purchase routes.
export function registerPurchaseRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	const { needSession, limit } = createGuards(deps);

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/purchases",
		preValidation: limit,
		handler: async (request, reply) => {
			const bad = missingFieldError(request.body, ["reservationId"]);
			if (bad !== undefined) return sendError(reply, bad);
			return sendResult(
				reply,
				await deps.purchases.confirm(
					request.params.saleId,
					shopperOf(request),
					fieldOf(request.body, "reservationId"),
				),
				({ created, purchase }) =>
					createdOrOk(reply, created).send(purchaseView(purchase)),
			);
		},
	});

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/purchases/me",
		preValidation: needSession,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.purchases.outcome(request.params.saleId, shopperOf(request)),
				({ user, outcome }) => outcomeReply(reply, user, outcome),
			),
	});
}
