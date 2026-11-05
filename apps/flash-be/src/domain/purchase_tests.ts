import { describe, expect, it } from "vitest";
import { isPurchaseOf, type Purchase } from "./purchase.js";

const purchase: Purchase = {
	id: "p-1",
	saleId: "s-1",
	user: "ana",
	reservationId: "r-1",
	paymentRef: "pay-1",
	purchasedAt: new Date("2026-01-01T10:00:00Z"),
};

describe("purchase rules", () => {
	it("belongs to the shopper and the sale it was made for", () => {
		expect(isPurchaseOf(purchase, "s-1", "ana")).toBe(true);
		expect(isPurchaseOf(purchase, "s-1", "bo")).toBe(false);
		expect(isPurchaseOf(purchase, "s-2", "ana")).toBe(false);
	});
});
