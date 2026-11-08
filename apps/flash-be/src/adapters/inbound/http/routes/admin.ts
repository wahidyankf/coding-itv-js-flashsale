// The operator's sale routes: create, list, change and remove a sale. Each needs an operator's login, and the rate limit
// counts them by address before anything is read. What a write may do is a rule of the domain (sale-window), and these
// routes only read the body and shape the reply. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import { describeAdminSale, describeSale } from "../sale-view.js";
import { saleDraftBody, salePatchBody } from "./bodies.js";
import { createGuards, operatorOf, type SaleParams } from "./guards.js";
import { sendError, sendResult } from "./reply.js";

// Registers the operator's sale routes under /admin/sales. Each needs an operator's login, and flash-web never passes them on.
export function registerAdminRoutes(
	app: FastifyInstance,
	deps: Dependencies,
): void {
	const { needOperator, limitAdmin } = createGuards(deps);
	const guarded = [limitAdmin, needOperator];

	// The admin service refuses a window that overlaps another sale (`sale_overlaps`).
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
				(found) =>
					reply
						.code(HTTP_STATUS.created)
						.send(describeSale(found.sale, found.status)),
			);
		},
	});

	// An operator reads every sale, with the numbers that only an operator needs.
	app.route({
		method: "GET",
		url: "/admin/sales",
		onRequest: guarded,
		handler: async (_request, reply) => {
			const listed = (await deps.admin.list()).map(({ sale, status }) =>
				describeAdminSale(sale, status),
			);
			return reply.code(HTTP_STATUS.ok).send({ sales: listed });
		},
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
				(found) =>
					reply
						.code(HTTP_STATUS.ok)
						.send(describeSale(found.sale, found.status)),
			);
		},
	});

	// A sale with a purchase is refused (`sale_has_purchases`), so only a sale nobody bought from is removed.
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
