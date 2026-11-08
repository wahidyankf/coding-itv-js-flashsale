// Unit tests of the sale path helper of the k6 script: it fills the `:saleId` placeholder of an API path with the sale this
// run uses. The expected paths are written out here, so a renamed route fails this test.
import { describe, expect, it } from "vitest";
import { saleRoute } from "./paths.ts";

describe("saleRoute", () => {
	it("fills the sale id into the path of the sale's queue", () => {
		expect(saleRoute("/api/v1/sales/:saleId/queue", "sale-1")).toBe(
			"/api/v1/sales/sale-1/queue",
		);
	});

	it("fills the sale id into a path with more after it", () => {
		expect(saleRoute("/api/v1/sales/:saleId/purchases/me", "sale-1")).toBe(
			"/api/v1/sales/sale-1/purchases/me",
		);
	});
});
