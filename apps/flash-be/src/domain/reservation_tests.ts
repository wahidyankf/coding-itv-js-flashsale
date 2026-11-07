// Unit tests for the reservation rules of the domain: the hold request, and the one decision every store follows
// (the precedence table). The tests run without I/O, so the order of the checks is pinned here, not in a store.

import { describe, expect, it } from "vitest";
import { usernameOf } from "../bdd/support/users.js";
import {
	decideReservation,
	earlyReservationAnswer,
	type GateAnswer,
	holdRequest,
	type ReservationState,
	type ReserveRequest,
	roomReservationAnswer,
	type ShopperState,
} from "./reservation.js";
import type { Sale } from "./sale.js";

const sale: Sale = {
	id: "00000000-0000-4000-8000-000000000000",
	productId: "00000000-0000-4000-8000-0000000000aa",
	name: "Flash sale",
	startsAt: new Date("2026-01-01T10:00:00Z"),
	endsAt: new Date("2026-01-01T11:00:00Z"),
	stock: 3,
	sold: 0,
	holdSeconds: 90,
	admitPerSecond: 50,
};

describe("reservation rules", () => {
	it("holds an item for the time the sale sets", () => {
		const now = new Date("2026-01-01T10:00:00Z");
		const request = holdRequest(sale, usernameOf("ana"), "r-1", now);
		expect(request).toEqual({
			saleId: sale.id,
			user: "ana",
			reservationId: "r-1",
			now,
			expiresAt: new Date("2026-01-01T10:01:30Z"),
			stock: 3,
		});
	});
});

// One reserve request at a fixed moment. The hold it asks for ends one minute later.
const NOW = new Date("2026-01-01T10:00:00Z");
const LATER = new Date("2026-01-01T10:01:00Z");
const request: ReserveRequest = {
	saleId: sale.id,
	user: usernameOf("ana"),
	reservationId: "r-new",
	now: NOW,
	expiresAt: LATER,
	stock: 3,
};

// A state with nothing in it, so each case sets only what it is about.
function stateWith(over: Partial<ReservationState>): ReservationState {
	return {
		sold: 0,
		purchased: false,
		ownHold: undefined,
		othersHolding: 0,
		...over,
	};
}

const LIVE_OWN = { reservationId: "r-own", expiresAt: LATER };
// A hold whose end is this very moment: it no longer counts, as `isLive` says.
const ENDING_NOW = { reservationId: "r-old", expiresAt: NOW };
const RESERVED: GateAnswer = {
	kind: "reserved",
	reservationId: "r-new",
	expiresAt: LATER,
};

// The order of the checks, as one table: a purchase first, then the shopper's own live hold, then the stock with the
// live holds of the others. Each row names the rule it pins.
const precedence: Array<[string, Partial<ReservationState>, GateAnswer]> = [
	[
		"a purchase refuses a new hold, even with a free item",
		{ purchased: true },
		{ kind: "purchased" },
	],
	[
		"a purchase beats the shopper's live hold",
		{ purchased: true, ownHold: LIVE_OWN },
		{ kind: "purchased" },
	],
	[
		"a live hold of the shopper answers held, even when the sale is sold out",
		{ sold: 3, ownHold: LIVE_OWN },
		{ kind: "held", reservationId: "r-own", expiresAt: LATER },
	],
	[
		"a hold that ends at this moment does not count, so the shopper may hold again",
		{ ownHold: ENDING_NOW },
		RESERVED,
	],
	["the last free item goes to the shopper", { sold: 2 }, RESERVED],
	[
		"an item taken by a live hold of another shopper is gone",
		{ sold: 1, othersHolding: 2 },
		{ kind: "sold_out" },
	],
	["a sold out sale gives no hold", { sold: 3 }, { kind: "sold_out" }],
	[
		"a sold out sale refuses a shopper whose old hold has ended",
		{ sold: 3, ownHold: ENDING_NOW },
		{ kind: "sold_out" },
	],
];

describe("the reservation decision", () => {
	it.each(precedence)("%s", (_name, over, expected) => {
		expect(decideReservation(stateWith(over), request)).toEqual(expected);
	});
});

// The two steps of the decision, on their own. A store asks the early step first, and counts the stock only when it
// gives no answer, so the early step must answer exactly the rows of the table that come before the stock.
const shopperWith = (over: Partial<ShopperState>): ShopperState => ({
	purchased: false,
	ownHold: undefined,
	...over,
});

describe("the early answers of a reservation", () => {
	it.each([
		["a purchase answers first", { purchased: true }, { kind: "purchased" }],
		[
			"a purchase beats the live hold",
			{ purchased: true, ownHold: LIVE_OWN },
			{ kind: "purchased" },
		],
		[
			"a live hold answers held",
			{ ownHold: LIVE_OWN },
			{ kind: "held", reservationId: "r-own", expiresAt: LATER },
		],
		[
			"a hold that ends now gives no early answer",
			{ ownHold: ENDING_NOW },
			undefined,
		],
		["a shopper with nothing leaves the stock to decide", {}, undefined],
	])("%s", (_name, over, expected) => {
		expect(earlyReservationAnswer(shopperWith(over), request)).toEqual(
			expected,
		);
	});
});

describe("the room answer of a reservation", () => {
	it("gives the hold while the stock has room", () => {
		expect(
			roomReservationAnswer({ sold: 2, othersHolding: 0 }, request),
		).toEqual(RESERVED);
	});

	it("is sold out once the sold items and the other holds fill the stock", () => {
		expect(
			roomReservationAnswer({ sold: 1, othersHolding: 2 }, request),
		).toEqual({ kind: "sold_out" });
		expect(
			roomReservationAnswer({ sold: 3, othersHolding: 0 }, request),
		).toEqual({ kind: "sold_out" });
	});
});
