import type { APIRequestContext, APIResponse } from "@playwright/test";
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
import { startApi } from "./world.js";

export const TICKET_HEADER = "x-queue-ticket";

const FIRST_ERROR_STATUS = 400;

// A route is a method and a path. `B` is the body of its success reply; it is only there for the types.
export type Route<B = unknown> = {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	reply?: B;
};

const route = <B>(method: Route["method"], path: string): Route<B> => ({
	method,
	path,
});

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

export type Input = {
	params?: Record<string, string>;
	headers?: Record<string, string | undefined>;
	body?: unknown;
};

// The URL, headers and body text of a request to the private API of the scenario.
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

// The body of a reply that is not a refusal, or undefined.
export async function bodyOf<B>(
	_route: Route<B>,
	response: APIResponse,
): Promise<B | undefined> {
	return response.status() < FIRST_ERROR_STATUS
		? ((await response.json()) as B)
		: undefined;
}

// The `errorCode` of a refusal, or undefined.
export async function errorOf(
	response: APIResponse,
): Promise<string | undefined> {
	return response.status() >= FIRST_ERROR_STATUS
		? (await response.json()).errorCode
		: undefined;
}
