// The operator's side of the e2e scenarios: who sends a request (the operator, a shopper, or nobody), and the calls that make
// or change a sale through the admin routes. The admin routes are the only way a sale is made on the private API.

import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { givenFields, routes, send } from "./api.js";
import { operatorCookie, shopperCookie } from "./auth.js";

// Who sends a request: the operator who is logged in, the shopper "ana" who is logged in, or nobody.
export type Sender = "operator" | "shopper" | "nobody";

// The headers of a request from the operator, who must be logged in.
export async function operatorHeaders(
	request: APIRequestContext,
): Promise<Record<string, string>> {
	return { cookie: await operatorCookie(request) };
}

// The headers of a request from `sender`: the operator's login, the shopper "ana"'s login, or none at all.
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

// What an operator sends to create a sale. `productId` is left out when the sale should get the default product.
export type NewSaleInput = {
	name?: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
	productId?: string;
};

// Sets a sale up the way an operator does, through `POST /api/v1/admin/sales`, and returns its id. Windows in the past are fine for
// the API, so a sale that is already running needs no shortcut.
export async function createSale(
	request: APIRequestContext,
	sale: NewSaleInput,
): Promise<string> {
	const reply = await send(request, routes.createSale, {
		headers: await operatorHeaders(request),
		body: givenFields({
			name: sale.name,
			productId: sale.productId,
			stock: sale.stock,
			startsAt: sale.startsAt.toISOString(),
			endsAt: sale.endsAt.toISOString(),
		}),
	});
	expect(reply.status(), await reply.text()).toBe(201);
	return (await reply.json()).id;
}

// Changes some fields of a sale through `PATCH /api/v1/admin/sales/:saleId`, as an operator does. The reply must be a success.
export async function patchSale(
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
