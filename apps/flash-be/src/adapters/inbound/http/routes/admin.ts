// The operator's sale routes: create, list, change and remove a sale. Each needs an operator's login, and the rate limit
// counts them by address before anything is read. What a write may do is a rule of the domain (sale-window), and these
// routes only read the body and shape the reply. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import { saleDraftBody, salePatchBody } from "./bodies.js";
import { createGuards, operatorOf, type SaleParams } from "./guards.js";
import { sendError, sendResult } from "./reply.js";

// Registers the operator's sale routes.
export function registerAdminRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	const { needOperator, limitAdmin } = createGuards(deps);
	const guarded = [limitAdmin, needOperator];

	// An operator creates a sale. The window must not overlap another sale.
	app.route({
		method: "POST",
		url: "/admin/sales",
		// onRequest runs before the body is read, so a client without the token learns nothing from a broken body.
		onRequest: guarded,
		handler: async (request, reply) => {
			const draft = saleDraftBody(request.body);
			if (draft.isErr()) return sendError(reply, "invalid_sale");
			return sendResult(
				reply,
				await deps.admin.create(draft.value, operatorOf(request)),
				(sale) => reply.code(HTTP_STATUS.created).send(sale),
			);
		},
	});

	// An operator reads every sale, with the numbers that only an operator needs.
	app.route({
		method: "GET",
		url: "/admin/sales",
		onRequest: guarded,
		handler: async (_request, reply) =>
			reply.code(HTTP_STATUS.ok).send({ sales: await deps.admin.list() }),
	});

	// An operator changes a sale. What may change depends on whether the sale has started (see `changeSaleFrom`).
	app.route<{ Params: SaleParams }>({
		method: "PATCH",
		url: "/admin/sales/:saleId",
		onRequest: guarded,
		handler: async (request, reply) => {
			const patch = salePatchBody(request.body);
			if (patch.isErr()) return sendError(reply, "invalid_sale");
			return sendResult(
				reply,
				await deps.admin.update(
					request.params.saleId,
					patch.value,
					operatorOf(request),
				),
				(sale) => reply.code(HTTP_STATUS.ok).send(sale),
			);
		},
	});

	// An operator removes a sale that nobody has bought from.
	app.route<{ Params: SaleParams }>({
		method: "DELETE",
		url: "/admin/sales/:saleId",
		onRequest: guarded,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.admin.remove(request.params.saleId, operatorOf(request)),
				() => reply.code(HTTP_STATUS.ok).send({ id: request.params.saleId }),
			),
	});
}
