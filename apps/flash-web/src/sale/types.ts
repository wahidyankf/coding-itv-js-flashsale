// The shapes flash-be sends for a sale and a purchase, as the JSON carries them, each with the decoder that checks it. Dates
// are ISO strings. A decoder runs on every reply and every stream event before the page uses it (api.ts, client.ts and
// load.ts), so a payload of the wrong shape never reaches the page. The app's own shapes (the page's first load, the API's
// failure) live in load.ts and api.ts. It sits in the sale feature; the server load and the browser client both use it.
import {
	both,
	type Decoder,
	integer,
	isoDate,
	literal,
	nonEmptyText,
	nonNegativeInteger,
	object,
	oneOf,
	tagged,
	text,
	uuid,
} from "@flash/flash-commons";

// The states of a sale, as flash-be names them. The page shows each one, and only `active` lets a shopper buy.
const SALE_STATUSES = ["upcoming", "active", "sold_out", "ended"] as const;
// The sale's state as the page knows it. The values are flash-be's, so a new state there needs one here too.
export type SaleStatus = (typeof SALE_STATUSES)[number];

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
// Checks a sale reply before the page uses it. A missing or wrong field is refused, and the error names the field.
export const decodeSaleView: Decoder<SaleView> = object({
	id: uuid,
	productId: uuid,
	name: text,
	status: oneOf(SALE_STATUSES),
	startsAt: isoDate,
	endsAt: isoDate,
	stock: nonNegativeInteger,
	remaining: nonNegativeInteger,
});

// Where the shopper stands in the line: waiting at a place, admitted to buy, or not in the line at all. The views below add
// the shopper's id and the ticket.
export type Place =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };
// The three places, each told apart by its state.
const decodePlace: Decoder<Place> = tagged("state", {
	waiting: object({ state: literal("waiting"), place: integer }),
	admitted: object({ state: literal("admitted") }),
	absent: object({ state: literal("absent") }),
});

// A place in the line, with the shopper it is for.
export type PlaceView = Place & { userId: string };
// Checks a place reply: the place and the shopper's id. An empty id is refused, so a place is never tied to nobody.
export const decodePlaceView: Decoder<PlaceView> = both(
	object({ userId: nonEmptyText }),
	decodePlace,
);

// The answer to joining the line: the place, and the ticket that proves it.
export type JoinedView = PlaceView & { ticket: string };
// Checks the reply to joining the line. The ticket is required, because the shopper proves their place with it later.
export const decodeJoinedView: Decoder<JoinedView> = both(
	object({ ticket: text }),
	decodePlaceView,
);

// A hold on an item, and when the hold runs out.
export type ReservedView = {
	userId: string;
	reservationId: string;
	expiresAt: string;
};
// Checks a hold reply. The expiry must be a real ISO date, because the page counts the hold down to it.
export const decodeReservedView: Decoder<ReservedView> = object({
	userId: nonEmptyText,
	reservationId: uuid,
	expiresAt: isoDate,
});

// A completed purchase.
export type PurchaseView = {
	userId: string;
	purchaseId: string;
	reservationId: string;
	purchasedAt: string;
};
// Checks a purchase reply, the proof that the shopper got the item. Each id must be a UUID, as flash-be writes them.
export const decodePurchaseView: Decoder<PurchaseView> = object({
	userId: nonEmptyText,
	purchaseId: uuid,
	reservationId: uuid,
	purchasedAt: isoDate,
});

// Whether the shopper has bought, holds an item, or has neither. Each state has its own fields, so it is decoded by its
// `state`.
export type OutcomeView =
	| (PurchaseView & { state: "purchased" })
	| (ReservedView & { state: "holding" })
	| { userId: string; state: "none" };
// Checks the answer to "did I get it?". The state picks the fields that are required, so each of the three answers is
// checked in full.
export const decodeOutcomeView: Decoder<OutcomeView> = tagged("state", {
	purchased: both(decodePurchaseView, object({ state: literal("purchased") })),
	holding: both(decodeReservedView, object({ state: literal("holding") })),
	none: object({ userId: nonEmptyText, state: literal("none") }),
});
