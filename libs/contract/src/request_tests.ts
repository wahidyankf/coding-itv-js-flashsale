import { describe, expect, it } from "vitest";
import { buildRequest, matchRoute, pathOf } from "./request.js";
import { type RequestInput, routes } from "./routes.js";

describe("pathOf", () => {
	it("fills and escapes the parameters", () => {
		expect(pathOf(routes.placeEvents, { saleId: "s1", userId: "a b/c" })).toBe(
			"/sales/s1/queue/a%20b%2Fc/events",
		);
	});

	it("leaves a path without parameters as it is", () => {
		expect(pathOf(routes.health)).toBe("/health");
	});

	it("leaves a missing parameter empty", () => {
		expect(pathOf(routes.sale, {})).toBe("/sales/");
	});
});

describe("buildRequest", () => {
	it("builds a read with a base url and no body", () => {
		expect(
			buildRequest(routes.sale, { params: { saleId: "s1" } }, "http://api"),
		).toEqual({
			method: "GET",
			url: "http://api/sales/s1",
			headers: {},
			body: undefined,
		});
	});

	it("builds a write with a JSON body and the ticket header", () => {
		const request = buildRequest(routes.reserve, {
			params: { saleId: "s1" },
			headers: { "x-queue-ticket": "t" },
			body: { userId: "ana" },
		});
		expect(request).toEqual({
			method: "POST",
			url: "/sales/s1/reservations",
			headers: { "x-queue-ticket": "t", "content-type": "application/json" },
			body: '{"userId":"ana"}',
		});
	});

	it("leaves out a header that is not given", () => {
		const request = buildRequest(routes.checkPlace, {
			params: { saleId: "s1", userId: "ana" },
			headers: {},
		});
		expect(request.headers).toEqual({});
	});

	it("takes no input for a route without parts", () => {
		expect(buildRequest(routes.health, {}).url).toBe("/health");
	});

	it("leaves out a header whose value is undefined", () => {
		const request = buildRequest(routes.checkPlace, {
			params: { saleId: "s1", userId: "ana" },
			headers: { "x-queue-ticket": undefined },
		});
		expect(request.headers).toEqual({});
	});

	it("refuses a wrong input at compile time", () => {
		// @ts-expect-error a write route needs its body
		const missing: RequestInput<typeof routes.joinQueue> = {
			params: { saleId: "s1" },
		};
		const wrong: RequestInput<typeof routes.joinQueue> = {
			params: { saleId: "s1" },
			// @ts-expect-error a body field has the wrong type
			body: { userId: 5 },
		};
		expect([missing, wrong]).toHaveLength(2);
	});
});

describe("matchRoute", () => {
	it("finds the route and decodes its parameters", () => {
		expect(matchRoute("GET", "/sales/s1/queue/a%20b")).toEqual({
			route: routes.checkPlace,
			params: { saleId: "s1", userId: "a b" },
		});
		expect(matchRoute("POST", "/sales/s1/purchases")?.route).toBe(
			routes.confirm,
		);
	});

	it("takes a fixed path before a parameter", () => {
		expect(matchRoute("GET", "/sales/current")?.route).toBe(routes.currentSale);
		expect(matchRoute("GET", "/sales/other")?.route).toBe(routes.sale);
	});

	it("matches the method too", () => {
		expect(matchRoute("POST", "/sales/current")).toBeUndefined();
		expect(matchRoute("GET", "/sales/s1/reservations")).toBeUndefined();
	});

	it("matches nothing for a path it does not serve or a value it cannot decode", () => {
		expect(matchRoute("GET", "/nope")).toBeUndefined();
		expect(matchRoute("GET", "/sales/%E0%A4%A")).toBeUndefined();
		expect(matchRoute("GET", "/sales/s1/queue/x/extra")).toBeUndefined();
	});

	it("looks only at the routes it is given", () => {
		expect(matchRoute("GET", "/health", [routes.sale])).toBeUndefined();
		expect(matchRoute("GET", "/health", [routes.health])?.route).toBe(
			routes.health,
		);
	});
});
