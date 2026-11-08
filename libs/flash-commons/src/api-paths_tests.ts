// Plain Vitest tests for the API path table. The paths are written out here as literals, so a renamed route fails this test.
// The apps import the table, so this literal copy is the only check that a path change was made on purpose and reviewed.
import { describe, expect, it } from "vitest";
import {
	API_PATHS,
	API_PREFIX,
	AUTH_BASE_PATH,
	PROBE_PATHS,
} from "./api-paths.js";

describe("API_PREFIX and AUTH_BASE_PATH", () => {
	it("serve the API under /api/v1 and the auth routes under /api/v1/auth", () => {
		expect(API_PREFIX).toBe("/api/v1");
		expect(AUTH_BASE_PATH).toBe("/api/v1/auth");
	});
});

describe("PROBE_PATHS", () => {
	it("keeps the probes at the root, outside the API prefix", () => {
		expect(PROBE_PATHS).toEqual({ health: "/health", ready: "/ready" });
		for (const path of Object.values(PROBE_PATHS)) {
			expect(path.startsWith("/api/")).toBe(false);
		}
	});
});

describe("API_PATHS", () => {
	it("names every route by its literal path", () => {
		expect(API_PATHS).toEqual({
			saleCurrent: "/api/v1/sales/current",
			sale: "/api/v1/sales/:saleId",
			saleEvents: "/api/v1/sales/:saleId/events",
			queue: "/api/v1/sales/:saleId/queue",
			queueMe: "/api/v1/sales/:saleId/queue/me",
			queueMeEvents: "/api/v1/sales/:saleId/queue/me/events",
			reservations: "/api/v1/sales/:saleId/reservations",
			purchases: "/api/v1/sales/:saleId/purchases",
			purchaseMe: "/api/v1/sales/:saleId/purchases/me",
			authRegister: "/api/v1/auth/register",
			authLogin: "/api/v1/auth/login",
			authRefresh: "/api/v1/auth/refresh",
			authLogout: "/api/v1/auth/logout",
			authMe: "/api/v1/auth/me",
			adminSales: "/api/v1/admin/sales",
			adminSale: "/api/v1/admin/sales/:saleId",
		});
	});

	it("starts every path with /api/v1/", () => {
		for (const path of Object.values(API_PATHS)) {
			expect(path.startsWith("/api/v1/")).toBe(true);
		}
	});

	it("puts each auth route under the auth base path", () => {
		const auth = Object.entries(API_PATHS).filter(([name]) =>
			name.startsWith("auth"),
		);
		expect(auth).toHaveLength(5);
		for (const [, path] of auth) {
			expect(path.startsWith(`${AUTH_BASE_PATH}/`)).toBe(true);
		}
	});
});
