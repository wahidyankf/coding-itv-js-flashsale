import { describe, expect, expectTypeOf, it } from "vitest";
import type { ErrorCodeOf, Reply, RequestInput } from "./routes.js";
import { routes } from "./routes.js";
import { ERROR_STATUS, type JOIN_ERRORS } from "./vocabulary.js";

const all = Object.values(routes);

describe("the route table", () => {
	it("names each route by its key and gives no method and path twice", () => {
		for (const [key, route] of Object.entries(routes)) {
			expect(route.name).toBe(key);
		}
		const keys = all.map((route) => `${route.method} ${route.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("has a params schema for exactly the parameters in the path", () => {
		for (const route of all) {
			const inPath = [...route.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
			const declared = "params" in route ? Object.keys(route.params.shape) : [];
			expect(declared.sort()).toEqual(inPath.sort());
		}
	});

	it("answers each error code with the status of that code", () => {
		const codes = Object.keys(ERROR_STATUS) as Array<keyof typeof ERROR_STATUS>;
		for (const route of all) {
			for (const [status, schema] of Object.entries(route.replies)) {
				const accepted = codes.filter(
					(code) =>
						schema.safeParse({ error: code, retryAfterSeconds: 1 }).success,
				);
				for (const code of accepted) {
					expect(ERROR_STATUS[code]).toBe(Number(status));
				}
				// Only the success bodies and the readiness report list no code.
				if (Number(status) >= 400 && route.name !== "ready") {
					expect(accepted.length).toBeGreaterThan(0);
				}
			}
		}
	});

	it("limits every write route and no read route", () => {
		for (const route of all) {
			expect(route.limited).toBe(route.method === "POST");
			expect(429 in route.replies).toBe(route.limited);
		}
	});

	it("marks the streams and what the web server passes on", () => {
		expect(
			all.filter((route) => route.stream).map((route) => route.name),
		).toEqual(["saleEvents", "placeEvents"]);
		expect(routes.health.passThrough).toBe(false);
		expect(routes.ready.passThrough).toBe(false);
		expect(all.filter((route) => route.passThrough)).toHaveLength(9);
	});
});

describe("the types of a route", () => {
	it("asks for the parts a route declares", () => {
		expectTypeOf<RequestInput<typeof routes.health>>().toEqualTypeOf<unknown>();
		expectTypeOf<RequestInput<typeof routes.sale>>().toEqualTypeOf<{
			params: { saleId: string };
		}>();
		expectTypeOf<RequestInput<typeof routes.joinQueue>>().toEqualTypeOf<
			{ params: { saleId: string } } & { body: { userId: string } }
		>();
	});

	it("gives a reply the body of its status", () => {
		type Joined = Extract<Reply<typeof routes.joinQueue>, { status: 201 }>;
		expectTypeOf<Joined["body"]["ticket"]>().toBeString();
		type Gone = Extract<Reply<typeof routes.joinQueue>, { status: 404 }>;
		expectTypeOf<Gone["body"]>().toEqualTypeOf<{ error: "sale_not_found" }>();
	});

	it("lists the error codes of a route", () => {
		expectTypeOf<ErrorCodeOf<typeof routes.joinQueue>>().toEqualTypeOf<
			(typeof JOIN_ERRORS)[number] | "rate_limited"
		>();
	});
});
