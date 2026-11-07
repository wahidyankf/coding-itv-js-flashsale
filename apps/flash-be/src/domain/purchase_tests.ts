// The purchase rules: which purchase belongs to a sale and a shopper, and what a shopper sees (purchased, held, or nothing).
import { describe, expect, it } from "vitest";
import { isPurchaseOf, outcomeOf, type Purchase } from "./purchase.js";

const purchase: Purchase = {
	id: "p-1",
	saleId: "s-1",
	user: "ana",
	reservationId: "r-1",
	paymentRef: "pay-1",
	purchasedAt: new Date("2026-01-01T10:00:00Z"),
};

const NOW = new Date("2026-01-01T10:00:00Z");
const hold = {
	saleId: "s-1",
	user: "ana",
	reservationId: "r-2",
	expiresAt: new Date("2026-01-01T10:02:00Z"),
};

describe("purchase rules", () => {
	it("belongs to the shopper and the sale it was made for", () => {
		expect(isPurchaseOf(purchase, "s-1", "ana")).toBe(true);
		expect(isPurchaseOf(purchase, "s-1", "bo")).toBe(false);
		expect(isPurchaseOf(purchase, "s-2", "ana")).toBe(false);
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
});
