// Unit tests for the catch-all API route: an address under /api that no route above takes gets the proxy's refusal, so an
// old or operator path answers the same JSON `not_found` as any other refused path.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./$";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("the catch-all /api route", () => {
	it.each([
		["GET", "/api/sales/current"],
		["POST", "/api/auth/login"],
		["GET", "/api/v1/admin/sales"],
		["PATCH", "/api/v1/admin/sales/11111111-1111-4111-8111-111111111111"],
		["DELETE", "/api/v1/admin/sales/11111111-1111-4111-8111-111111111111"],
	])(
		"answers %s %s with not_found, and asks flash-be nothing",
		async (method, path) => {
			const fetcher = vi.fn(async () => Response.json({ ok: true }));
			vi.stubGlobal("fetch", fetcher);
			const handlers = Route.options.server?.handlers as unknown as Record<
				string,
				(context: { request: Request }) => Promise<Response>
			>;
			const reply = await handlers[method]?.({
				request: new Request(`http://web.test${path}`, {
					method,
					...(method === "GET" ? {} : { body: "{}" }),
				}),
			});
			expect(reply?.status).toBe(404);
			expect(await reply?.json()).toEqual({
				errorCode: "not_found",
				errorMessage: "Nothing was found at this address.",
			});
			expect(fetcher).not.toHaveBeenCalled();
		},
	);
});
