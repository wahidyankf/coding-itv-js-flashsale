// The bodies of the API as the steps read them. They are written by hand: a step only reads a few fields.

export type SaleView = {
	id: string;
	name: string;
	status: "upcoming" | "active" | "sold_out" | "ended";
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

// Where a user stands in a queue.
export type PlaceView = { userId: string } & (
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" }
);

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

export type StreamEvent =
	| { event: "sale"; data: SaleView }
	| { event: "place"; data: PlaceView };
