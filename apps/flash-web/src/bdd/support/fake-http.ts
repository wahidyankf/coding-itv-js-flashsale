// The HTTP face of the fake flash-be: the shape of a reply, the status and sentence of each error code as flash-be sends
// them, and the table that maps an address and a method to the name of a route. Test support only.

// The error codes the fake answers with, and the one status of each, as flash-be does.
export const ERROR_STATUS = {
	invalid_user: 400,
	invalid_password: 400,
	invalid_credentials: 401,
	not_authenticated: 401,
	invalid_refresh_token: 401,
	username_taken: 409,
	invalid_ticket: 401,
	payment_failed: 402,
	not_admitted: 403,
	sale_not_found: 404,
	reservation_not_found: 404,
	not_found: 404,
	sale_not_started: 409,
	sale_ended: 409,
	sold_out: 409,
	hold_expired: 409,
	already_purchased: 409,
	rate_limited: 429,
} as const;
// The error codes the fake knows. Each has one status, as in flash-be.
export type ErrorCode = keyof typeof ERROR_STATUS;

// What the fake answers with: a status, headers, cookies and a body.
export type Reply = {
	status: number;
	headers: Record<string, string>;
	// One `Set-Cookie` header each; they cannot be joined into one value.
	cookies?: string[];
	body: unknown;
};

// The body of an error reply, in flash-be's shape: the code and its sentence.
export const errorPayload = (code: ErrorCode) => ({
	errorCode: code,
	errorMessage: code.replaceAll("_", " "),
});

// Builds a reply from a status and a body.
export const reply = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
	cookies: string[] = [],
): Reply => ({ status, headers, body, cookies });

// The reply for an error code, with the one status that code has.
export const refuse = (error: ErrorCode) =>
	reply(ERROR_STATUS[error], errorPayload(error));

// The routes of flash-be that the page can reach, each with its method and path.
export type RouteName =
	| "register"
	| "login"
	| "refresh"
	| "logout"
	| "account"
	| "currentSale"
	| "sale"
	| "saleEvents"
	| "placeEvents"
	| "joinQueue"
	| "checkPlace"
	| "reserve"
	| "confirm"
	| "outcome";
const ROUTES: Array<[RouteName, string, RegExp]> = [
	["register", "POST", /^\/api\/v1\/auth\/register$/],
	["login", "POST", /^\/api\/v1\/auth\/login$/],
	["refresh", "POST", /^\/api\/v1\/auth\/refresh$/],
	["logout", "POST", /^\/api\/v1\/auth\/logout$/],
	["account", "GET", /^\/api\/v1\/auth\/me$/],
	["currentSale", "GET", /^\/api\/v1\/sales\/current$/],
	["sale", "GET", /^\/api\/v1\/sales\/(?<saleId>[^/]+)$/],
	["saleEvents", "GET", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/events$/],
	["joinQueue", "POST", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/queue$/],
	["checkPlace", "GET", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/queue\/me$/],
	[
		"placeEvents",
		"GET",
		/^\/api\/v1\/sales\/(?<saleId>[^/]+)\/queue\/me\/events$/,
	],
	["reserve", "POST", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/reservations$/],
	["confirm", "POST", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/purchases$/],
	["outcome", "GET", /^\/api\/v1\/sales\/(?<saleId>[^/]+)\/purchases\/me$/],
];

// The route that matched, and the parts of its address (the sale id).
export type Match = { name: RouteName; params: Record<string, string> };

// The route for a method and a path, or undefined when flash-be has no such route.
export function matchRoute(method: string, path: string): Match | undefined {
	for (const [name, allowed, pattern] of ROUTES) {
		if (allowed !== method) continue;
		const found = pattern.exec(path);
		if (!found) continue;
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(found.groups ?? {})) {
			params[key] = decodeURIComponent(value);
		}
		return { name, params };
	}
	return undefined;
}
