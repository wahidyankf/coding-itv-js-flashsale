// Unit tests for the sale's decoders: each view as flash-be sends it, and the bad payloads that matter (a missing field, a
// wrong type, a status or a place that is not one of the named ones, a date or an id that is not one).
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import {
	decodeJoinedView,
	decodeOutcomeView,
	decodePlaceView,
	decodePurchaseView,
	decodeReservedView,
	decodeSaleView,
} from "./types";

const SALE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const PURCHASE_ID = "44444444-4444-4444-8444-444444444444";
const WHEN = "2026-06-01T12:00:00.000Z";

const SALE = {
	id: SALE_ID,
	productId: PRODUCT_ID,
	name: "Drop",
	status: "active",
	startsAt: WHEN,
	endsAt: WHEN,
	stock: 10,
	remaining: 2,
};

describe("decodeSaleView", () => {
	it("reads the sale as flash-be sends it", () => {
		expect(decodeSaleView(SALE)).toEqual(new Ok(SALE));
	});

	it("ignores a field it does not name", () => {
		expect(decodeSaleView({ ...SALE, holdSeconds: 120 })).toEqual(new Ok(SALE));
	});

	it("names the count that is missing", () => {
		const { remaining: _gone, ...lacking } = SALE;
		expect(decodeSaleView(lacking)).toEqual(
			new Err({ path: "remaining", expected: "a non-negative integer" }),
		);
	});

	it("refuses a count that is not a whole number", () => {
		expect(decodeSaleView({ ...SALE, stock: "10" })).toEqual(
			new Err({ path: "stock", expected: "a non-negative integer" }),
		);
	});

	it("refuses a status that is not one of the four", () => {
		expect(decodeSaleView({ ...SALE, status: "closed" })).toEqual(
			new Err({
				path: "status",
				expected: 'one of "upcoming", "active", "sold_out", "ended"',
			}),
		);
	});

	it("refuses a date that is not a date", () => {
		expect(decodeSaleView({ ...SALE, startsAt: "June 1 2026" })).toEqual(
			new Err({ path: "startsAt", expected: "an ISO date and time" }),
		);
	});

	it("refuses an id that is not a UUID", () => {
		expect(decodeSaleView({ ...SALE, id: "s1" })).toEqual(
			new Err({ path: "id", expected: "a UUID" }),
		);
	});
});

describe("decodePlaceView", () => {
	it.each([
		{ userId: "ana", state: "waiting", place: 3 },
		{ userId: "ana", state: "admitted" },
		{ userId: "ana", state: "absent" },
	])("reads the place %j", (place) => {
		expect(decodePlaceView(place)).toEqual(new Ok(place));
	});

	it("refuses a state that is not one of the three", () => {
		expect(decodePlaceView({ userId: "ana", state: "queued" })).toEqual(
			new Err({
				path: "state",
				expected: 'one of "waiting", "admitted", "absent"',
			}),
		);
	});

	it("refuses a waiting place with no place number", () => {
		expect(decodePlaceView({ userId: "ana", state: "waiting" })).toEqual(
			new Err({ path: "place", expected: "an integer" }),
		);
	});

	it("refuses a place with no user", () => {
		expect(decodePlaceView({ state: "admitted" })).toEqual(
			new Err({ path: "userId", expected: "a non-empty text" }),
		);
	});
});

describe("decodeJoinedView", () => {
	it("reads the place and the ticket that proves it", () => {
		const joined = { userId: "ana", ticket: "t", state: "waiting", place: 1 };
		expect(decodeJoinedView(joined)).toEqual(new Ok(joined));
	});

	it("refuses a join with no ticket", () => {
		expect(decodeJoinedView({ userId: "ana", state: "admitted" })).toEqual(
			new Err({ path: "ticket", expected: "text" }),
		);
	});
});

describe("decodeReservedView", () => {
	const HOLD = {
		userId: "ana",
		reservationId: RESERVATION_ID,
		expiresAt: WHEN,
	};

	it("reads the hold", () => {
		expect(decodeReservedView(HOLD)).toEqual(new Ok(HOLD));
	});

	it("refuses a hold whose end is not a date", () => {
		expect(decodeReservedView({ ...HOLD, expiresAt: 5 })).toEqual(
			new Err({ path: "expiresAt", expected: "an ISO date and time" }),
		);
	});

	it("refuses a hold whose reservation is not a UUID", () => {
		expect(decodeReservedView({ ...HOLD, reservationId: "r1" })).toEqual(
			new Err({ path: "reservationId", expected: "a UUID" }),
		);
	});
});

describe("decodePurchaseView", () => {
	const PURCHASE = {
		userId: "ana",
		purchaseId: PURCHASE_ID,
		reservationId: RESERVATION_ID,
		purchasedAt: WHEN,
	};

	it("reads the purchase", () => {
		expect(decodePurchaseView(PURCHASE)).toEqual(new Ok(PURCHASE));
	});

	it("refuses a purchase with no time of purchase", () => {
		const { purchasedAt: _gone, ...lacking } = PURCHASE;
		expect(decodePurchaseView(lacking)).toEqual(
			new Err({ path: "purchasedAt", expected: "an ISO date and time" }),
		);
	});
});

describe("decodeOutcomeView", () => {
	const PURCHASE = {
		userId: "ana",
		purchaseId: PURCHASE_ID,
		reservationId: RESERVATION_ID,
		purchasedAt: WHEN,
		state: "purchased",
	};
	const HOLDING = {
		userId: "ana",
		state: "holding",
		reservationId: RESERVATION_ID,
		expiresAt: WHEN,
	};

	it("reads a purchase, a live hold or nothing, by its state", () => {
		expect(decodeOutcomeView(PURCHASE)).toEqual(new Ok(PURCHASE));
		expect(decodeOutcomeView(HOLDING)).toEqual(new Ok(HOLDING));
		expect(decodeOutcomeView({ userId: "ana", state: "none" })).toEqual(
			new Ok({ userId: "ana", state: "none" }),
		);
	});

	it("refuses a state that is none of the three, and names the three", () => {
		expect(decodeOutcomeView({ userId: "ana", state: "refunded" })).toEqual(
			new Err({
				path: "state",
				expected: 'one of "purchased", "holding", "none"',
			}),
		);
	});

	it("refuses a purchase that is missing a field of its own", () => {
		const { purchaseId: _gone, ...lacking } = PURCHASE;
		expect(decodeOutcomeView(lacking)).toEqual(
			new Err({ path: "purchaseId", expected: "a UUID" }),
		);
	});

	it("refuses a hold whose end is not a date", () => {
		expect(decodeOutcomeView({ ...HOLDING, expiresAt: "soon" })).toEqual(
			new Err({ path: "expiresAt", expected: "an ISO date and time" }),
		);
	});
});
