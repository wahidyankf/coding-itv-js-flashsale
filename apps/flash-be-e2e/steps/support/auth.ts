// The accounts of the e2e scenarios and the cookies that log them in. A step that needs a login asks here, so each account
// is made once per scenario and its cookie is reused. The web e2e app logs in through fetch, so the login itself is passed
// in; the parsing and the caching are shared.

import { applySetCookies, cookieHeaderOf } from "@flash/flash-commons";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { routes, send } from "./api.js";
import { createOperator } from "./database.js";
import { setCookiesOf } from "./response.js";
import { world } from "./world.js";

// The operator the scenarios log in as. The `create-operator` command makes this account, once per scenario.
export const E2E_OPERATOR = "e2e-operator";
// The password of every account the scenarios make.
export const E2E_PASSWORD = "e2e long password";

const CREATED = 201;
const OK = 200;

// What a login answered: its status, and the Set-Cookie values of the reply.
export type LoginAnswer = { status: number; setCookies: string[] };
// Sends a login through whichever client the caller holds: the Playwright request context or fetch.
export type LoginCall = (credentials: {
	username: string;
	password: string;
}) => Promise<LoginAnswer>;

// The username as the API stores it: trimmed and in lower case. Every map of users is keyed this way.
export function usernameKey(username: string): string {
	return username.trim().toLowerCase();
}

// The `cookie` header a client sends next, from the Set-Cookie values of a reply. A cookie the reply cleared (Max-Age=0) is
// left out, because a client that has cleared it sends nothing. The whole login is sent, whatever each cookie's path.
export function cookieHeaderFrom(setCookies: readonly string[]): string {
	return cookieHeaderOf(applySetCookies(new Map(), setCookies));
}

// The cookie header of each login the scenario holds, by usernameKey, and of the operator by E2E_OPERATOR.
export function logins(): Map<string, string> {
	world.logins ??= new Map();
	return world.logins;
}

// The cookie header kept under `key`. When there is none yet, `make` produces it once, and it is kept for the rest of the
// scenario.
export async function cookieOnce(
	key: string,
	make: () => Promise<string>,
): Promise<string> {
	const known = logins().get(key);
	if (known !== undefined) return known;
	const cookie = await make();
	logins().set(key, cookie);
	return cookie;
}

// A shopper's cookie header. The account is signed up through the API the first time, and later calls reuse its login.
export async function shopperCookie(
	request: APIRequestContext,
	username: string,
): Promise<string> {
	const key = usernameKey(username);
	return cookieOnce(key, async () => {
		const reply = await send(request, routes.register, {
			body: { username: key, password: E2E_PASSWORD },
		});
		expect(reply.status(), await reply.text()).toBe(CREATED);
		return cookieHeaderFrom(setCookiesOf(reply));
	});
}

// The operator's cookie header, for the steps that send the operator's requests. The account is made by the command the
// first time, and logged in through `login`, which the caller provides.
export function operatorCookieVia(login: LoginCall): Promise<string> {
	return cookieOnce(E2E_OPERATOR, async () => {
		createOperator(E2E_OPERATOR, E2E_PASSWORD);
		const answer = await login({
			username: E2E_OPERATOR,
			password: E2E_PASSWORD,
		});
		expect(answer.status, "the operator got no login").toBe(OK);
		return cookieHeaderFrom(answer.setCookies);
	});
}

// The operator's cookie header, with the login sent through the Playwright request context.
export function operatorCookie(request: APIRequestContext): Promise<string> {
	return operatorCookieVia(async (credentials) => {
		const reply = await send(request, routes.login, { body: credentials });
		return { status: reply.status(), setCookies: setCookiesOf(reply) };
	});
}
