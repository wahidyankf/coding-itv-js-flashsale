// Tests the route table: the paths registerRoutes serves are exactly the API paths and the probes. The expected paths are
// written out here, so a path that changes must be changed in this test on purpose.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { healthyDeps } from "../../../../bdd/support/deps.js";
import { createOpenStreams, DEFAULT_STREAM_OPTIONS } from "../event-stream.js";
import { registerRoutes } from "./index.js";

// Every path the app serves, as written: the API under /api/v1 and the two probes at the root.
const EXPECTED_PATHS = [
	"/api/v1/sales/current",
	"/api/v1/sales/:saleId",
	"/api/v1/sales/:saleId/events",
	"/api/v1/sales/:saleId/queue",
	"/api/v1/sales/:saleId/queue/me",
	"/api/v1/sales/:saleId/queue/me/events",
	"/api/v1/sales/:saleId/reservations",
	"/api/v1/sales/:saleId/purchases",
	"/api/v1/sales/:saleId/purchases/me",
	"/api/v1/auth/register",
	"/api/v1/auth/login",
	"/api/v1/auth/refresh",
	"/api/v1/auth/logout",
	"/api/v1/auth/me",
	"/api/v1/admin/sales",
	"/api/v1/admin/sales/:saleId",
	"/health",
	"/ready",
];

// The paths of every route registerRoutes adds. Fastify reports each route to the onRoute hook, and a GET route also gets a
// HEAD route on the same path, so the paths are collected as a set.
function registeredPaths(): string[] {
	const app = Fastify();
	const paths = new Set<string>();
	app.addHook("onRoute", (route) => {
		paths.add(route.url);
	});
	registerRoutes(
		app,
		healthyDeps,
		{ ...DEFAULT_STREAM_OPTIONS, open: createOpenStreams() },
		{ secure: false, isStopping: () => false },
	);
	return [...paths].sort();
}

describe("the route table", () => {
	it("registers exactly the API paths under /api/v1 and the two probes", () => {
		expect(registeredPaths()).toEqual([...EXPECTED_PATHS].sort());
	});

	it("serves every path except the probes under /api/v1/", () => {
		const api = registeredPaths().filter(
			(path) => path !== "/health" && path !== "/ready",
		);
		expect(api).toHaveLength(EXPECTED_PATHS.length - 2);
		for (const path of api) {
			expect(path.startsWith("/api/v1/")).toBe(true);
		}
	});
});
