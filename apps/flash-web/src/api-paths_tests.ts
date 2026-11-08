// Unit tests for the browser routes the proxy passes on: which ones, in what order, and how a route becomes a pattern or an
// address. The expected paths are written out here, so a renamed route fails this test.
import { describe, expect, it } from "vitest";
import { BROWSER_ROUTES, fillSaleId, routePattern } from "./api-paths";

const SALE = "11111111-1111-4111-8111-111111111111";

describe("BROWSER_ROUTES", () => {
	it("lists the shopper's routes, each with its one method, in the order the proxy checks them", () => {
		expect(BROWSER_ROUTES).toEqual([
			["POST", "/api/v1/auth/register"],
			["POST", "/api/v1/auth/login"],
			["POST", "/api/v1/auth/refresh"],
			["POST", "/api/v1/auth/logout"],
			["GET", "/api/v1/auth/me"],
			// The current sale comes before the sale-id pattern, which would otherwise match it.
			["GET", "/api/v1/sales/current"],
			["GET", "/api/v1/sales/:saleId"],
			["GET", "/api/v1/sales/:saleId/events"],
			["POST", "/api/v1/sales/:saleId/queue"],
			["GET", "/api/v1/sales/:saleId/queue/me"],
			["GET", "/api/v1/sales/:saleId/queue/me/events"],
			["POST", "/api/v1/sales/:saleId/reservations"],
			["POST", "/api/v1/sales/:saleId/purchases"],
			["GET", "/api/v1/sales/:saleId/purchases/me"],
		]);
	});

	it("has no operator route", () => {
		expect(BROWSER_ROUTES.some(([, path]) => path.includes("/admin"))).toBe(
			false,
		);
	});
});

describe("routePattern", () => {
	it("matches the path and names the sale id", () => {
		const found = routePattern("/api/v1/sales/:saleId/queue").exec(
			`/api/v1/sales/${SALE}/queue`,
		);
		expect(found?.groups?.saleId).toBe(SALE);
	});

	it("matches only the whole path", () => {
		const pattern = routePattern("/api/v1/auth/me");
		expect(pattern.test("/api/v1/auth/me")).toBe(true);
		expect(pattern.test("/api/v1/auth/me/extra")).toBe(false);
		expect(pattern.test("/x/api/v1/auth/me")).toBe(false);
	});

	it("reads a dot in the template as a dot, not as any character", () => {
		expect(routePattern("/api/v1/a.b").test("/api/v1/axb")).toBe(false);
	});
});

describe("fillSaleId", () => {
	it("puts the sale id in the placeholder", () => {
		expect(fillSaleId("/api/v1/sales/:saleId/queue", SALE)).toBe(
			`/api/v1/sales/${SALE}/queue`,
		);
	});

	it("encodes the sale id, so no id can name another path", () => {
		expect(fillSaleId("/api/v1/sales/:saleId", "a b/c")).toBe(
			"/api/v1/sales/a%20b%2Fc",
		);
	});
});
