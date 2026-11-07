import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { routes, send } from "./api.js";
import { createOperator, E2E_OPERATOR, E2E_PASSWORD, world } from "./world.js";

// A `cookie` header from what a reply set: the cookies that were given a value, not the ones that were cleared.
export function cookieHeaderOf(response: APIResponse): string {
	return response
		.headersArray()
		.filter((header) => header.name.toLowerCase() === "set-cookie")
		.filter((header) => !header.value.includes("Max-Age=0"))
		.map((header) => header.value.split(";")[0])
		.join("; ");
}

function logins(): Map<string, string> {
	world.logins ??= new Map();
	return world.logins;
}

// The cookie header of a shopper who is logged in. The account is made the first time, through the sign-up route.
export async function shopperCookie(
	request: APIRequestContext,
	username: string,
): Promise<string> {
	const key = username.trim().toLowerCase();
	const known = logins().get(key);
	if (known !== undefined) return known;
	const reply = await send(request, routes.register, {
		body: { username: key, password: E2E_PASSWORD },
	});
	expect(reply.status(), await reply.text()).toBe(201);
	const cookie = cookieHeaderOf(reply);
	logins().set(key, cookie);
	return cookie;
}

// The cookie header of the operator. The account is made with the command, then logged in through the API.
export async function operatorCookie(
	request: APIRequestContext,
): Promise<string> {
	const known = logins().get(E2E_OPERATOR);
	if (known !== undefined) return known;
	createOperator(E2E_OPERATOR, E2E_PASSWORD);
	const reply = await send(request, routes.login, {
		body: { username: E2E_OPERATOR, password: E2E_PASSWORD },
	});
	expect(reply.status(), await reply.text()).toBe(200);
	const cookie = cookieHeaderOf(reply);
	logins().set(E2E_OPERATOR, cookie);
	return cookie;
}
