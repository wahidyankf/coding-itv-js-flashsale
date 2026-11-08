// The scenario's side of the web server: which flash-be it reaches, the sale the scenario plans, and the logins of its shoppers and operator.
// The planned sale is made late, the first time the page needs the API, so steps after the plan can still change it. Shoppers log in directly, as other clients would.

import { API_PATHS, HTTP_STATUS, MS_PER_HOUR } from "@flash/flash-commons";
import {
	givenFields,
	TICKET_HEADER,
} from "../../../flash-be-e2e/steps/support/api.js";
import {
	cookieHeaderFrom,
	cookieOnce,
	E2E_PASSWORD,
	operatorCookieVia,
	usernameKey,
} from "../../../flash-be-e2e/steps/support/auth.js";
import { cleanup as cleanupBackend } from "../../../flash-be-e2e/steps/support/cleanup.js";
import {
	ensureDatabase,
	setSold,
} from "../../../flash-be-e2e/steps/support/database.js";
import { startApi } from "../../../flash-be-e2e/steps/support/processes.js";
import { pollUntilAdmitted } from "../../../flash-be-e2e/steps/support/shoppers.js";
import { relativeTime } from "../../../flash-be-e2e/steps/support/time.js";
import {
	currentSaleId,
	world,
} from "../../../flash-be-e2e/steps/support/world.js";
import { fetchJson, saleRoute } from "./api.js";
import { forwarder } from "./forwarder.js";

// How long a shopper waits to be admitted: the page's waits and the shoppers' polls both use it, so one number says how long
// a queue may take.
export const ADMISSION_WAIT_MS = 20_000;
// How often a shopper's place is read while the shopper waits to be admitted.
export const ADMISSION_POLL_MS = 100;

// True when a step has already chosen where the web server's API address leads.
const target: { chosen: boolean } = { chosen: false };

// What a scenario says about its sale. The sale is made later, so steps after the plan (a slow queue, a short hold) can still shape it.
type SalePlan = {
	stock: number;
	sold: number;
	opens: Date;
	closes: Date;
	holdSeconds?: number;
	admitPerSecond?: number;
};
let planned: SalePlan | undefined;

// The settings a step may change on the sale. A field left out keeps what the sale has.
type SaleChange = {
	holdSeconds?: number;
	admitPerSecond?: number;
	closes?: Date;
};

// The cookie header of the operator on this API. The command makes the account once, and fetch logs it in.
function operatorCookie(api: string): Promise<string> {
	return operatorCookieVia(async (credentials) => {
		const reply = await fetchJson(
			"POST",
			`${api}${API_PATHS.authLogin}`,
			credentials,
		);
		return { status: reply.status, setCookies: reply.headers.getSetCookie() };
	});
}

// One call of the operator to flash-be, which must succeed. Returns the sale the API answered with.
async function operator(
	api: string,
	method: "POST" | "PATCH",
	path: string,
	body: object,
): Promise<{ id: string }> {
	const reply = await fetchJson(method, `${api}${path}`, body, {
		cookie: await operatorCookie(api),
	});
	const text = await reply.text();
	if (!reply.ok)
		throw new Error(`${method} ${path} gave ${reply.status}: ${text}`);
	return JSON.parse(text) as { id: string };
}

// A JSON request as the shopper with this cookie: the cookie is sent, and so are any extra headers.
function postAs(
	cookie: string,
	url: string,
	body: object,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetchJson("POST", url, body, { cookie, ...headers });
}

// The cookie header of a shopper of this scenario's flash-be. The account is signed up the first time, when the login is
// refused; a later call reuses the login. A page or an earlier step may already have made the account, so it logs in first.
export async function loginOrSignUp(
	username: string,
	password = E2E_PASSWORD,
	apiUrl?: string,
): Promise<string> {
	const key = usernameKey(username);
	return cookieOnce(key, async () => {
		const api = apiUrl ?? (await privateApi());
		const body = { username: key, password };
		let reply = await fetchJson("POST", `${api}${API_PATHS.authLogin}`, body);
		if (reply.status === HTTP_STATUS.unauthorized) {
			reply = await fetchJson("POST", `${api}${API_PATHS.authRegister}`, body);
		}
		if (!reply.ok) {
			throw new Error(
				`${key} got no login: ${reply.status} ${await reply.text()}`,
			);
		}
		return cookieHeaderFrom(reply.headers.getSetCookie());
	});
}

// An account that exists but is not logged in anywhere, made as a deployment's sign-up would make it.
export async function createAccount(
	username: string,
	password: string,
): Promise<void> {
	const api = await privateApi();
	const reply = await fetchJson("POST", `${api}${API_PATHS.authRegister}`, {
		username: usernameKey(username),
		password,
	});
	if (reply.status !== HTTP_STATUS.created) {
		throw new Error(`${username} was not made: ${reply.status}`);
	}
}

// Plans the sale the scenario talks about. It is made later, when the API first starts.
export function planSale(
	stock: number,
	sold: number,
	opens: string,
	closes: string,
): void {
	const now = new Date();
	planned = {
		stock,
		sold,
		opens: relativeTime(opens, now),
		closes: relativeTime(closes, now),
	};
}

// Changes the sale's settings: the plan while the sale is not made yet, and the operator route after that.
export async function reviseSale(change: SaleChange): Promise<void> {
	if (planned) {
		planned = { ...planned, ...givenFields(change) };
		return;
	}
	const api = await privateApi();
	await operator(
		api,
		"PATCH",
		saleRoute(API_PATHS.adminSale, currentSaleId()),
		{
			...givenFields({
				holdSeconds: change.holdSeconds,
				admitPerSecond: change.admitPerSecond,
				endsAt: change.closes?.toISOString(),
			}),
		},
	);
}

// Shoppers u1..uN each buy one item through the real routes. They all go at the same time.
async function buyItems(
	api: string,
	saleId: string,
	count: number,
): Promise<void> {
	await Promise.all(
		Array.from({ length: count }, (_, index) =>
			buyItem(api, saleId, `u${index + 1}`),
		),
	);
}

// One shopper's way to an item: queue, wait to be admitted, hold, and purchase. A step that does not answer as expected throws.
async function buyItem(api: string, saleId: string, user: string) {
	const at = (template: string) => `${api}${saleRoute(template, saleId)}`;
	const cookie = await loginOrSignUp(user, E2E_PASSWORD, api);
	const joined = await postAs(cookie, at(API_PATHS.queue), {});
	const { ticket } = (await joined.json()) as { ticket: string };
	const headers = { [TICKET_HEADER]: ticket };
	await waitForAdmission(at(API_PATHS.queueMe), cookie, headers, user);
	const held = await postAs(cookie, at(API_PATHS.reservations), {}, headers);
	if (held.status !== HTTP_STATUS.created)
		throw new Error(`${user} got no hold: ${held.status}`);
	const { reservationId } = (await held.json()) as { reservationId: string };
	const bought = await postAs(cookie, at(API_PATHS.purchases), {
		reservationId,
	});
	if (bought.status !== HTTP_STATUS.created)
		throw new Error(`${user} bought nothing: ${bought.status}`);
}

// Reads the shopper's place until the API admits them, or the wait runs out.
async function waitForAdmission(
	placeUrl: string,
	cookie: string,
	headers: Record<string, string>,
	user: string,
): Promise<void> {
	await pollUntilAdmitted(
		async () => {
			const place = await fetch(placeUrl, {
				headers: { cookie, ...headers },
			});
			return ((await place.json()) as { state: string }).state;
		},
		{
			withinMs: ADMISSION_WAIT_MS,
			everyMs: ADMISSION_POLL_MS,
			failure: `${user} was not admitted`,
		},
	);
}

// Makes the planned sale on the scenario's flash-be. Items can be bought only while the window is open, so a sale that is
// already over is made open, sold from, and then closed by moving its end. A sale that has not opened yet cannot be bought
// from by any route; the sold count is written to the table, as another instance would write it.
async function makePlannedSale(api: string): Promise<void> {
	if (!planned) return;
	const plan = planned;
	planned = undefined;
	const now = Date.now();
	const over = plan.closes.getTime() <= now;
	const opened = plan.opens.getTime() <= now;
	const created = await operator(api, "POST", API_PATHS.adminSales, {
		stock: plan.stock,
		startsAt: plan.opens.toISOString(),
		endsAt: (over && plan.sold > 0
			? new Date(now + MS_PER_HOUR)
			: plan.closes
		).toISOString(),
		...givenFields({
			holdSeconds: plan.holdSeconds,
			admitPerSecond: plan.admitPerSecond,
		}),
	});
	world.saleId = created.id;
	if (plan.sold === 0) return;
	if (!opened) {
		// No route sells before the sale opens, so this one count is written to the table.
		await setSold(created.id, plan.sold);
		return;
	}
	await buyItems(api, created.id, plan.sold);
	if (over) {
		await operator(api, "PATCH", saleRoute(API_PATHS.adminSale, created.id), {
			endsAt: plan.closes.toISOString(),
		});
	}
}

// The scenario's own flash-be, started on first use, with the sale the scenario planned. Returns its URL.
export async function privateApi(): Promise<string> {
	await ensureDatabase();
	const api = await startApi();
	await makePlannedSale(api);
	return api;
}

// Points the web server at this scenario's flash-be, unless a step has already chosen another place.
export async function connectWebServer(): Promise<void> {
	if (target.chosen) return;
	const url = await privateApi();
	await forwarder.to(Number(new URL(url).port));
}

// Makes the API unreachable for the web server: the forwarder drops every connection.
export async function cutWebServerOff(): Promise<void> {
	target.chosen = true;
	await forwarder.cut();
}

// Makes the API answer every call of the web server with this status and body, instead of the real API.
export async function answerWith(status: number, body: string): Promise<void> {
	target.chosen = true;
	await forwarder.canned(status, body);
}

// Points the web server at a flash-be that is already running, such as the shared one of the e2e stack.
export async function pointAtSharedBackend(port: number): Promise<void> {
	target.chosen = true;
	await forwarder.to(port);
}

// Ends the scenario: the forwarder is pointed nowhere, the plan is dropped, and the backend is cleaned up.
export async function cleanup(): Promise<void> {
	target.chosen = false;
	planned = undefined;
	await forwarder.reset();
	await cleanupBackend();
}
