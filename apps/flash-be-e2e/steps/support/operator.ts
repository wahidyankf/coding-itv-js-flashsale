import { type APIRequestContext, expect } from "@playwright/test";
import { ADMIN_AUTH_HEADER, routes, send } from "./api.js";
import { E2E_ADMIN_TOKEN, world } from "./world.js";

// The header of an operator. A scenario that set its own token (the admin scenarios do) is believed.
export function operatorHeaders(token?: string): Record<string, string> {
	const given = token ?? world.apiEnv?.ADMIN_TOKEN ?? E2E_ADMIN_TOKEN;
	return { [ADMIN_AUTH_HEADER]: `Bearer ${given}` };
}

export type NewSaleInput = {
	name?: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
};

// Sets a sale up the way an operator does, through `POST /admin/sales`, and returns its id. Windows in the past are
// fine for the API, so a sale that is already running needs no shortcut.
export async function createSale(
	request: APIRequestContext,
	sale: NewSaleInput,
): Promise<string> {
	const reply = await send(request, routes.createSale, {
		headers: operatorHeaders(),
		body: {
			...(sale.name === undefined ? {} : { name: sale.name }),
			stock: sale.stock,
			startsAt: sale.startsAt.toISOString(),
			endsAt: sale.endsAt.toISOString(),
		},
	});
	expect(reply.status(), await reply.text()).toBe(201);
	return (await reply.json()).id;
}

// Changes a sale through `PATCH /admin/sales/:saleId`, the way an operator does.
export async function changeSale(
	request: APIRequestContext,
	saleId: string,
	patch: Record<string, unknown>,
): Promise<void> {
	const reply = await send(request, routes.updateSale, {
		params: { saleId },
		headers: operatorHeaders(),
		body: patch,
	});
	expect(reply.status(), await reply.text()).toBe(200);
}
