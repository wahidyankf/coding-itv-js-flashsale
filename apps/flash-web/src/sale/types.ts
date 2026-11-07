// The shapes flash-be sends for a sale and a purchase, as the JSON carries them. Dates are ISO strings. Types only: the
// app's own shapes (the page's first load, the API's failure) live in load.ts and api.ts.

export type SaleStatus = "upcoming" | "active" | "sold_out" | "ended";

// A sale as the API shows it. `remaining` is what is still for sale.
export type SaleView = {
	id: string;
	productId: string;
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

// A place in the line, with the shopper it is for.
export type PlaceView = Place & { userId: string };
// The answer to joining the line: the place, and the ticket that proves it.
export type JoinedView = PlaceView & { ticket: string };
// A hold on an item, and when the hold runs out.
export type ReservedView = {
	userId: string;
	reservationId: string;
	expiresAt: string;
};
// A completed purchase.
export type PurchaseView = {
	userId: string;
	purchaseId: string;
	reservationId: string;
	purchasedAt: string;
};
// Whether the shopper has bought, holds an item, or has neither.
export type OutcomeView =
	| (PurchaseView & { state: "purchased" })
	| (ReservedView & { state: "holding" })
	| { userId: string; state: "none" };
