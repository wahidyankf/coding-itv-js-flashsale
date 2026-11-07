// How the e2e steps call the private API of a scenario: the routes, the request builder, and how a reply is read. The paths
// are written by hand, as AGENTS.md asks of the e2e apps; a route change must also update the list in
// docs/how-to/change-an-endpoint.md.

import { FIRST_ERROR_STATUS } from "@flash/flash-commons";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { startApi } from "./processes.js";
import type {
	AccountView,
	AdminSaleView,
	JoinedView,
	OutcomeView,
	PlaceView,
	PurchaseView,
	ReservedView,
	SaleView,
} from "./views.js";

// The header that carries the queue ticket. flash-web-e2e sends it too.
export const TICKET_HEADER = "x-queue-ticket";

// A route is a method and a path with `:name` placeholders. `B` is the body of its success reply; it only types the reply.
export type Route<B = unknown> = {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	reply?: B;
};

const route = <B>(method: Route["method"], path: string): Route<B> => ({
	method,
	path,
});

// Every route the steps call, by a name that says what it does.
export const routes = {
	currentSale: route<SaleView>("GET", "/sales/current"),
	sale: route<SaleView>("GET", "/sales/:saleId"),
	saleEvents: route("GET", "/sales/:saleId/events"),
	placeEvents: route("GET", "/sales/:saleId/queue/me/events"),
	joinQueue: route<JoinedView>("POST", "/sales/:saleId/queue"),
	checkPlace: route<PlaceView>("GET", "/sales/:saleId/queue/me"),
	reserve: route<ReservedView>("POST", "/sales/:saleId/reservations"),
	confirm: route<PurchaseView>("POST", "/sales/:saleId/purchases"),
	outcome: route<OutcomeView>("GET", "/sales/:saleId/purchases/me"),
	register: route<AccountView>("POST", "/auth/register"),
	login: route<AccountView>("POST", "/auth/login"),
	refresh: route<AccountView>("POST", "/auth/refresh"),
	logout: route("POST", "/auth/logout"),
	me: route<AccountView>("GET", "/auth/me"),
	createSale: route<SaleView>("POST", "/admin/sales"),
	updateSale: route<SaleView>("PATCH", "/admin/sales/:saleId"),
	removeSale: route<{ id: string }>("DELETE", "/admin/sales/:saleId"),
	listSales: route<{ sales: AdminSaleView[] }>("GET", "/admin/sales"),
};

// What a request carries: values for the path placeholders, headers (an undefined one is left out), and a JSON body.
export type Input = {
	params?: Record<string, string>;
	headers?: Record<string, string | undefined>;
	body?: unknown;
};

// The URL, headers and body text of a request to the scenario's private API. Starts that API if it is not running yet.
export async function build(route: Route, input: Input = {}) {
	const path = route.path.replace(/:(\w+)/g, (_match, name: string) =>
		encodeURIComponent(input.params?.[name] ?? ""),
	);
	// An empty `cookie` header is always there: without one, the request context of Playwright would send the cookies it
	// kept from earlier replies, as a browser does, and a step that means "nobody is logged in" would be someone.
	const headers: Record<string, string> = { cookie: "" };
	for (const [name, value] of Object.entries(input.headers ?? {})) {
		if (value !== undefined) headers[name.toLowerCase()] = value;
	}
	if (input.body !== undefined) headers["content-type"] = "application/json";
	return {
		url: `${await startApi()}${path}`,
		headers,
		body: input.body === undefined ? null : JSON.stringify(input.body),
	};
}

// Sends a request to the private API and returns the reply, without reading it. Use bodyOf or errorOf to read it.
export async function send(
	request: APIRequestContext,
	route: Route,
	input: Input = {},
): Promise<APIResponse> {
	const built = await build(route, input);
	return request.fetch(built.url, {
		method: route.method,
		headers: built.headers,
		data: built.body,
	});
}

// The body of a reply that is not a refusal, or undefined when the reply is a refusal.
export async function bodyOf<B>(
	_route: Route<B>,
	response: APIResponse,
): Promise<B | undefined> {
	return response.status() < FIRST_ERROR_STATUS
		? ((await response.json()) as B)
		: undefined;
}

// The fields that have a value. A body is built from these, so a field a step leaves unset is not sent at all, rather than
// sent as undefined (which JSON would drop) or as null (which the API would refuse).
export function givenFields<T extends Record<string, unknown>>(
	fields: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}

// The `errorCode` of a refusal, or undefined when the reply is not one.
export async function errorOf(
	response: APIResponse,
): Promise<string | undefined> {
	return response.status() >= FIRST_ERROR_STATUS
		? (await response.json()).errorCode
		: undefined;
}
