// The operator's sale routes: create, list, change and remove a sale. Each needs an operator's login, and the rate limit
// counts them by address before anything is read. What a write may do is a rule of the domain (sale-window), and these
// routes only read the body and shape the reply. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { SaleDraft, SalePatch } from "../../../../domain/sale-window.js";
import { fieldOf } from "./bodies.js";
import { createGuards, operatorOf, type SaleParams } from "./guards.js";
import { sendError, sendResult } from "./reply.js";

// A sale to create, if the body has the right types. Whether the values make a usable sale is the rule of the domain.
function saleDraftOf(body: unknown): SaleDraft | undefined {
	const field = (name: string) => fieldOf(body, name);
	const optional = (name: string, type: "string" | "number") =>
		field(name) === undefined || typeof field(name) === type;
	const productId = field("productId");
	const name = field("name");
	const stock = field("stock");
	const startsAt = field("startsAt");
	const endsAt = field("endsAt");
	const holdSeconds = field("holdSeconds");
	const admitPerSecond = field("admitPerSecond");
	if (
		typeof stock !== "number" ||
		typeof startsAt !== "string" ||
		typeof endsAt !== "string" ||
		!optional("productId", "string") ||
		!optional("name", "string") ||
		!optional("holdSeconds", "number") ||
		!optional("admitPerSecond", "number")
	) {
		return undefined;
	}
	return {
		productId: productId as string | undefined,
		name: name as string | undefined,
		stock,
		startsAt,
		endsAt,
		holdSeconds: holdSeconds as number | undefined,
		admitPerSecond: admitPerSecond as number | undefined,
	};
}

// The type each field of a sale change must have, if it is there.
const PATCH_FIELD_TYPE = {
	name: "string",
	startsAt: "string",
	endsAt: "string",
	stock: "number",
	holdSeconds: "number",
	admitPerSecond: "number",
} as const;

// A change to a sale, if every field that is there has the right type. A body with no field at all gives an empty
// change, which the domain refuses.
function salePatchOf(body: unknown): SalePatch | undefined {
	const patch: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(PATCH_FIELD_TYPE)) {
		const value = fieldOf(body, name);
		if (value === undefined) continue;
		if (typeof value !== type) return undefined;
		patch[name] = value;
	}
	return patch as SalePatch;
}

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
			const draft = saleDraftOf(request.body);
			if (draft === undefined) return sendError(reply, "invalid_sale");
			return sendResult(
				reply,
				await deps.admin.create(draft, operatorOf(request)),
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
			const patch = salePatchOf(request.body);
			if (patch === undefined) return sendError(reply, "invalid_sale");
			return sendResult(
				reply,
				await deps.admin.update(
					request.params.saleId,
					patch,
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
