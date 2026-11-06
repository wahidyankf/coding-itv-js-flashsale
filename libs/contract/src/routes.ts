// The route table: every endpoint of the API, written once. The server registers its handlers from it, the clients
// build their requests and read the replies from it, and the OpenAPI file is generated from the routes the server
// registered. To change an endpoint, change it here first.

import type { z } from "zod";
import {
	AdminHeaders,
	ConfirmBody,
	CreateSaleBody,
	errorReplies,
	HealthView,
	JoinedView,
	OutcomeView,
	PlaceParams,
	PlaceView,
	PurchaseView,
	RateLimitedBody,
	ReadyView,
	ReservedView,
	SaleParams,
	SaleView,
	TicketHeaders,
	UserBody,
} from "./schemas.js";
import {
	ADMIN_ERRORS,
	CHECK_ERRORS,
	CONFIRM_ERRORS,
	type ErrorCode,
	JOIN_ERRORS,
	OUTCOME_ERRORS,
	RESERVE_ERRORS,
} from "./vocabulary.js";

export type Method = "GET" | "POST";

export type Route = {
	readonly name: string;
	readonly summary: string;
	readonly method: Method;
	// With `:name` parameters, in the syntax of the server.
	readonly path: string;
	readonly params?: z.ZodObject;
	readonly headers?: z.ZodObject;
	readonly body?: z.ZodObject;
	// The reply schema for each HTTP status the route answers with. A stream names its status 200 for the document.
	readonly replies: { readonly [status: number]: z.ZodType };
	// The web server passes this route on to the API.
	readonly passThrough: boolean;
	// The 200 reply is a Server-Sent Events stream, not a JSON body.
	readonly stream: boolean;
	// A write route that the rate limiter looks at.
	readonly limited: boolean;
};

type Flags = Pick<Route, "passThrough" | "stream" | "limited">;

function defineRoute<const R extends Omit<Route, keyof Flags> & Partial<Flags>>(
	route: R,
): R & Flags {
	return { passThrough: false, stream: false, limited: false, ...route };
}

const limitedReply = { 429: RateLimitedBody } as const;

// Any route can fail inside the server. A route with a body can also be sent a body that cannot be read.
const readFailures = ["internal"] as const;
const writeFailures = ["invalid_request", "internal"] as const;

export const routes = {
	health: defineRoute({
		name: "health",
		summary: "Liveness: the process is up. It checks no dependency.",
		method: "GET",
		path: "/health",
		replies: { 200: HealthView, ...errorReplies(readFailures) },
	}),
	ready: defineRoute({
		name: "ready",
		summary: "Readiness: Postgres and Redis both answer.",
		method: "GET",
		path: "/ready",
		replies: { 200: ReadyView, 503: ReadyView, ...errorReplies(readFailures) },
	}),
	currentSale: defineRoute({
		name: "currentSale",
		summary: "The sale a shopper sees: the one that opens last.",
		method: "GET",
		path: "/sales/current",
		replies: {
			200: SaleView,
			...errorReplies(["sale_not_found", ...readFailures]),
		},
		passThrough: true,
	}),
	sale: defineRoute({
		name: "sale",
		summary: "One sale by id.",
		method: "GET",
		path: "/sales/:saleId",
		params: SaleParams,
		replies: {
			200: SaleView,
			...errorReplies(["sale_not_found", ...readFailures]),
		},
		passThrough: true,
	}),
	saleEvents: defineRoute({
		name: "saleEvents",
		summary: "Live sale status as Server-Sent Events (event `sale`).",
		method: "GET",
		path: "/sales/:saleId/events",
		params: SaleParams,
		replies: {
			200: SaleView,
			...errorReplies(["sale_not_found", ...readFailures]),
		},
		stream: true,
		passThrough: true,
	}),
	placeEvents: defineRoute({
		name: "placeEvents",
		summary: "Live place in the queue as Server-Sent Events (event `place`).",
		method: "GET",
		path: "/sales/:saleId/queue/:userId/events",
		params: PlaceParams,
		headers: TicketHeaders,
		replies: {
			200: PlaceView,
			...errorReplies([...CHECK_ERRORS, ...readFailures]),
		},
		stream: true,
		passThrough: true,
	}),
	joinQueue: defineRoute({
		name: "joinQueue",
		summary: "Join the waiting queue. The reply holds the ticket.",
		method: "POST",
		path: "/sales/:saleId/queue",
		params: SaleParams,
		body: UserBody,
		replies: {
			200: JoinedView,
			201: JoinedView,
			...errorReplies([...JOIN_ERRORS, ...writeFailures]),
			...limitedReply,
		},
		limited: true,
		passThrough: true,
	}),
	checkPlace: defineRoute({
		name: "checkPlace",
		summary: "Check a place in the queue. Needs the ticket.",
		method: "GET",
		path: "/sales/:saleId/queue/:userId",
		params: PlaceParams,
		headers: TicketHeaders,
		replies: {
			200: PlaceView,
			...errorReplies([...CHECK_ERRORS, ...readFailures]),
		},
		passThrough: true,
	}),
	reserve: defineRoute({
		name: "reserve",
		summary: "Hold one item for the sale's hold time. Needs the ticket.",
		method: "POST",
		path: "/sales/:saleId/reservations",
		params: SaleParams,
		headers: TicketHeaders,
		body: UserBody,
		replies: {
			200: ReservedView,
			201: ReservedView,
			...errorReplies([...RESERVE_ERRORS, ...writeFailures]),
			...limitedReply,
		},
		limited: true,
		passThrough: true,
	}),
	confirm: defineRoute({
		name: "confirm",
		summary: "Pay for the held item. Sending it again is safe.",
		method: "POST",
		path: "/sales/:saleId/purchases",
		params: SaleParams,
		body: ConfirmBody,
		replies: {
			200: PurchaseView,
			201: PurchaseView,
			...errorReplies([...CONFIRM_ERRORS, ...writeFailures]),
			...limitedReply,
		},
		limited: true,
		passThrough: true,
	}),
	// An operator route. The web server never passes it on, and it answers `not_found` when no admin token is set.
	createSale: defineRoute({
		name: "createSale",
		summary:
			"Create a sale. Needs the admin token; refuses a window that overlaps another sale.",
		method: "POST",
		path: "/admin/sales",
		headers: AdminHeaders,
		body: CreateSaleBody,
		replies: {
			201: SaleView,
			...errorReplies([...ADMIN_ERRORS, ...writeFailures]),
			...limitedReply,
		},
		limited: true,
	}),
	outcome: defineRoute({
		name: "outcome",
		summary: "Did I get it? A purchase, a live hold, or nothing.",
		method: "GET",
		path: "/sales/:saleId/purchases/:userId",
		params: PlaceParams,
		replies: {
			200: OutcomeView,
			...errorReplies([...OUTCOME_ERRORS, ...readFailures]),
		},
		passThrough: true,
	}),
} as const;

export type Routes = typeof routes;

type Input<
	R extends Route,
	K extends "params" | "headers" | "body",
> = R[K] extends z.ZodObject ? z.input<R[K]> : never;

// What a caller supplies to make a request: only the parts the route declares. Headers are always optional, because
// the ticket header is optional in the API itself.
export type RequestInput<R extends Route> = ([Input<R, "params">] extends [
	never,
]
	? unknown
	: { params: Input<R, "params"> }) &
	([Input<R, "headers">] extends [never]
		? unknown
		: { headers?: Input<R, "headers"> }) &
	([Input<R, "body">] extends [never] ? unknown : { body: Input<R, "body"> });

// Every reply a route may answer with: each HTTP status with the body its schema gives, errors included.
export type AnyReply<R extends Route> = {
	[S in keyof R["replies"] & number]: {
		status: S;
		body: z.output<R["replies"][S]>;
	};
}[keyof R["replies"] & number];

// The replies that are not refusals. A client gets these as `Ok`; a refusal is an `Err` that names the error.
export type Reply<R extends Route> = Exclude<
	AnyReply<R>,
	{ body: { error: ErrorCode } }
>;

// The error codes a route may answer with, so the error type of a handler can be checked against it.
export type ErrorCodeOf<R extends Route> = Extract<
	AnyReply<R>["body"],
	{ error: ErrorCode }
>["error"];
