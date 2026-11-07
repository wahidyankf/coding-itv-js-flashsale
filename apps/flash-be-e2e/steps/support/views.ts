// The bodies of the private API as the steps read them. They are written by hand: a step only reads the fields it checks,
// so these types list those fields and no more.

// The public view of a sale. A step reads the fields it checks; the API may send more.
export type SaleView = {
	id: string;
	productId: string;
	name: string;
	status: "upcoming" | "active" | "sold_out" | "ended";
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

// A sale as the operator list shows it: the public view and the numbers only an operator needs.
export type AdminSaleView = SaleView & {
	sold: number;
	holdSeconds: number;
	admitPerSecond: number;
};

// Who is logged in.
export type AccountView = { username: string; role: "shopper" | "operator" };

// Where a user stands in a queue.
export type PlaceView = { userId: string } & (
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" }
);

// The answer to joining a queue: the place and the ticket that proves it.
export type JoinedView = PlaceView & { ticket: string };

// A hold on an item and when it runs out.
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

// What a shopper's outcome in a sale is: bought, holding an item, or neither.
export type OutcomeView =
	| (PurchaseView & { state: "purchased" })
	| (ReservedView & { state: "holding" })
	| { userId: string; state: "none" };

// One event of a live stream, with the data it carries.
export type StreamEvent =
	| { event: "sale"; data: SaleView }
	| { event: "place"; data: PlaceView };
