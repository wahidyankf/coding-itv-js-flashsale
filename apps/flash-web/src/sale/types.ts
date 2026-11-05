import type { Result } from "@flash/typekit";
export type SaleStatus = "upcoming" | "active" | "sold_out" | "ended";

// What GET /sales/:id sends, and what the sale stream pushes.
export type SaleView = {
	id: string;
	name: string;
	status: SaleStatus;
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

// What the server renders the first time: the sale, no sale yet, or a sale that could not be read.
export type SaleLoad =
	| { state: "ok"; sale: SaleView }
	| { state: "none" }
	| { state: "error" };

export type Place =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };

export type Outcome =
	| { state: "purchased" }
	| { state: "holding"; reservationId: string; expiresAt: string }
	| { state: "none" };

// An answer from the web server: the body, or the error code the API gave, or "network" when nothing answered.
export type ApiError = {
	error: string;
	retryAfterSeconds?: number | undefined;
};

export type ApiResult<T> = Result<T, ApiError>;
