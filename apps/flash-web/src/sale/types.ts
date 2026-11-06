import type { Result } from "@flash/typekit";
import type { ApiFailure } from "../api";

export type { ApiFailure };

// The shapes flash-be sends. Dates are ISO strings, as JSON carries them.
export type SaleStatus = "upcoming" | "active" | "sold_out" | "ended";

export type SaleView = {
	id: string;
	name: string;
	status: SaleStatus;
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

// Where the shopper stands in the line. The ticket and the name that come with a place are not needed to show it.
export type Place =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };

export type PlaceView = Place & { userId: string };
export type JoinedView = PlaceView & { ticket: string };
export type ReservedView = {
	userId: string;
	reservationId: string;
	expiresAt: string;
};
export type PurchaseView = {
	userId: string;
	purchaseId: string;
	reservationId: string;
	purchasedAt: string;
};
export type OutcomeView =
	| (PurchaseView & { state: "purchased" })
	| (ReservedView & { state: "holding" })
	| { userId: string; state: "none" };

// What the server renders the first time: the sale, no sale yet, or a sale that could not be read.
export type SaleLoad =
	| { state: "ok"; sale: SaleView }
	| { state: "none" }
	| { state: "error" };

// An answer from the web server: the body, or why there is none (the code the API gave, `network`, or `unexpected`).
export type ApiResult<T> = Result<T, ApiFailure>;
