// The purchase routes: a shopper pays for the item their hold keeps, and asks "did I get it?". Inbound HTTP adapter.

import { API_PATHS, HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { Outcome, Purchase } from "../../../../domain/purchase.js";
import type { Username } from "../../../../domain/user.js";
import { reservationBody } from "./bodies.js";
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

// Registers the purchase routes. The shopper is the one who is logged in (the `purchaseMe` path); no URL names a user.
export function registerPurchaseRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	const { needSession, limit } = createGuards(deps);

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: API_PATHS.purchases,
		preValidation: limit,
		handler: async (request, reply) => {
			const body = reservationBody(request.body);
			if (body.isErr()) return sendError(reply, "invalid_reservation");
			return sendResult(
				reply,
				await deps.purchases.confirm(
					request.params.saleId,
					shopperOf(request),
					body.value.reservationId,
				),
				({ created, purchase }) =>
					createdOrOk(reply, created).send(purchaseView(purchase)),
			);
		},
	});

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: API_PATHS.purchaseMe,
		preValidation: needSession,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.purchases.outcome(request.params.saleId, shopperOf(request)),
				({ user, outcome }) => outcomeReply(reply, user, outcome),
			),
	});
}
