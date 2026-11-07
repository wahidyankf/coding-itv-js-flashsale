import { type APIRequestContext, expect } from "@playwright/test";
import { routes, send } from "./api.js";
import { operatorCookie, shopperCookie } from "./auth.js";

// The header of an operator who is logged in.
export async function operatorHeaders(
	request: APIRequestContext,
): Promise<Record<string, string>> {
	return { cookie: await operatorCookie(request) };
}

// Who sends a request: the operator who is logged in, the shopper "ana" who is logged in, or nobody.
export type Sender = "operator" | "shopper" | "nobody";

export async function senderHeaders(
	request: APIRequestContext,
	sender: Sender,
): Promise<Record<string, string>> {
	if (sender === "nobody") return {};
	return {
		cookie:
			sender === "operator"
				? await operatorCookie(request)
				: await shopperCookie(request, "ana"),
	};
}

export type NewSaleInput = {
	name?: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
	productId?: string;
};

// Sets a sale up the way an operator does, through `POST /admin/sales`, and returns its id. Windows in the past are
// fine for the API, so a sale that is already running needs no shortcut.
export async function createSale(
	request: APIRequestContext,
	sale: NewSaleInput,
): Promise<string> {
	const reply = await send(request, routes.createSale, {
		headers: await operatorHeaders(request),
		body: {
			...(sale.name === undefined ? {} : { name: sale.name }),
			...(sale.productId === undefined ? {} : { productId: sale.productId }),
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
		headers: await operatorHeaders(request),
		body: patch,
	});
	expect(reply.status(), await reply.text()).toBe(200);
}
