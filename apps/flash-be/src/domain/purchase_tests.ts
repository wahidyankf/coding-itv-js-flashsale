// The purchase rules: which purchase belongs to a sale and a shopper, and what a shopper sees (purchased, held, or nothing).

import { describe, expect, it } from "vitest";
import { usernameOf } from "../bdd/support/users.js";
import {
	holdRefusalOf,
	isPurchaseOf,
	outcomeOf,
	type Purchase,
} from "./purchase.js";

const purchase: Purchase = {
	id: "p-1",
	saleId: "s-1",
	user: usernameOf("ana"),
	reservationId: "r-1",
	paymentRef: "pay-1",
	purchasedAt: new Date("2026-01-01T10:00:00Z"),
};

const NOW = new Date("2026-01-01T10:00:00Z");
const hold = {
	saleId: "s-1",
	user: usernameOf("ana"),
	reservationId: "r-2",
	expiresAt: new Date("2026-01-01T10:02:00Z"),
};

describe("purchase rules", () => {
	it("belongs to the shopper and the sale it was made for", () => {
		expect(isPurchaseOf(purchase, "s-1", usernameOf("ana"))).toBe(true);
		expect(isPurchaseOf(purchase, "s-1", usernameOf("bo"))).toBe(false);
		expect(isPurchaseOf(purchase, "s-2", usernameOf("ana"))).toBe(false);
	});

	it("says a purchase first, then a live hold, then nothing", () => {
		expect(outcomeOf(purchase, hold, NOW)).toEqual({
			state: "purchased",
			purchase,
		});
		expect(outcomeOf(undefined, hold, NOW)).toEqual({
			state: "holding",
			reservationId: "r-2",
			expiresAt: hold.expiresAt,
		});
		expect(outcomeOf(undefined, undefined, NOW)).toEqual({ state: "none" });
	});

	it("does not show a hold that has run out", () => {
		const late = new Date("2026-01-01T10:02:00Z");
		expect(outcomeOf(undefined, hold, late)).toEqual({ state: "none" });
	});

	// The paying step checks the hold the same way for every shopper: it must be theirs, under this reservation id, and
	// still live. Anything else is refused with the reason, and nothing is charged.
	it("refuses a hold that is not the shopper's, or not this reservation, or not live", () => {
		const ours = { ...hold, reservationId: "r-2" };
		expect(holdRefusalOf(undefined, "r-2", NOW)).toBe("reservation_not_found");
		expect(holdRefusalOf(ours, "r-other", NOW)).toBe("reservation_not_found");
		expect(holdRefusalOf(ours, "r-2", hold.expiresAt)).toBe("hold_expired");
		expect(holdRefusalOf(ours, "r-2", NOW)).toBeUndefined();
	});
});
