// Unit tests for the proxy: which routes pass, which POSTs are refused as cross-site, and which headers and cookies move.
import { describe, expect, it, vi } from "vitest";
import { isAllowed, isCrossSite, proxyToBackend } from "./proxy";

const ENV = { FLASH_BE_URL: "http://flash-be.test" };
const ID = "11111111-1111-4111-8111-111111111111";

describe("isAllowed", () => {
	it.each([
		["POST", "/api/v1/auth/register"],
		["POST", "/api/v1/auth/login"],
		["POST", "/api/v1/auth/refresh"],
		["POST", "/api/v1/auth/logout"],
		["GET", "/api/v1/auth/me"],
		["GET", "/api/v1/sales/current"],
		["GET", `/api/v1/sales/${ID}`],
		["GET", `/api/v1/sales/${ID}/events`],
		["POST", `/api/v1/sales/${ID}/queue`],
		["GET", `/api/v1/sales/${ID}/queue/me`],
		["GET", `/api/v1/sales/${ID}/queue/me/events`],
		["POST", `/api/v1/sales/${ID}/reservations`],
		["POST", `/api/v1/sales/${ID}/purchases`],
		["GET", `/api/v1/sales/${ID}/purchases/me`],
	])("lets %s %s through", (method, path) => {
		expect(isAllowed(method, path)).toBe(true);
	});

	it.each([
		["POST", "/api/v1/sales/current"],
		["GET", `/api/v1/sales/${ID}/queue`],
		["GET", `/api/v1/sales/${ID}/reservations`],
		["DELETE", `/api/v1/sales/${ID}`],
		["POST", "/api/v1/admin/sales"],
		["GET", "/api/v1/admin/sales"],
		["PATCH", `/api/v1/admin/sales/${ID}`],
		["DELETE", `/api/v1/admin/sales/${ID}`],
		["GET", "/api/v1/sales/../ready"],
		["GET", "/ready"],
		["GET", "/health"],
		["GET", `/api/v1/sales/${ID}/purchases/me/extra`],
		["GET", "/api/v1/sales/not-a-sale-id"],
		["GET", "/api/v1/sales/%E0%A4%A"],
		// The shopper comes from the cookie, so a name in the address is not a route.
		["GET", `/api/v1/sales/${ID}/queue/ana`],
		["GET", `/api/v1/sales/${ID}/queue/ana/events`],
		["GET", `/api/v1/sales/${ID}/purchases/ana`],
		["GET", "/api/v1/auth/login"],
		["POST", "/api/v1/auth/me"],
		["POST", "/api/v1/auth/other"],
		["GET", "/api/v1/auth"],
		// A path without the version is an old path, and it is refused.
		["GET", "/api/sales/current"],
		["GET", "/api/auth/me"],
		["POST", "/api/auth/login"],
		["GET", `/api/sales/${ID}`],
		["GET", "/sales/current"],
	])("refuses %s %s", (method, path) => {
		expect(isAllowed(method, path)).toBe(false);
	});
});

describe("isCrossSite", () => {
	const post = (headers: Record<string, string>) =>
		new Request("http://web.test/api/v1/auth/login", {
			method: "POST",
			headers,
		});

	it.each([
		["the same host", { origin: "http://web.test" }, false],
		["another host", { origin: "http://evil.test" }, true],
		["the same name on another port", { origin: "http://web.test:81" }, true],
		["an origin that is not an address", { origin: "null" }, true],
		[
			"the host behind a proxy",
			{ origin: "https://shop.test", "x-forwarded-host": "shop.test" },
			false,
		],
		[
			"another host behind a proxy",
			{ origin: "http://web.test", "x-forwarded-host": "shop.test" },
			true,
		],
		[
			"the host header",
			{ origin: "http://shop.test:3000", host: "shop.test:3000" },
			false,
		],
		[
			"a fetch from the same origin",
			{ "sec-fetch-site": "same-origin" },
			false,
		],
		["a typed address", { "sec-fetch-site": "none" }, false],
		["a fetch from another site", { "sec-fetch-site": "cross-site" }, true],
		["a fetch from a sibling host", { "sec-fetch-site": "same-site" }, true],
		["a caller that is not a browser", {}, false],
	])("reads %s", (_name, headers, crossSite) => {
		expect(isCrossSite(post(headers))).toBe(crossSite);
	});

	it("trusts Origin before Sec-Fetch-Site", () => {
		expect(
			isCrossSite(
				post({ origin: "http://evil.test", "sec-fetch-site": "same-origin" }),
			),
		).toBe(true);
	});
});

describe("proxyToBackend", () => {
	it("passes on only the headers the API needs", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response("{}", { headers: { "x-secret": "no" } }),
		);
		await proxyToBackend(
			new Request(`http://web.test/api/v1/sales/${ID}/reservations`, {
				method: "POST",
				body: '{"userId":"ana"}',
				headers: {
					"content-type": "application/json",
					"x-queue-ticket": "t1",
					"x-forwarded-for": "203.0.113.9",
					cookie: "session=1",
					authorization: "Bearer x",
				},
			}),
			ENV,
			fetcher,
		);
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://flash-be.test/api/v1/sales/${ID}/reservations`);
		expect(init?.body).toBe('{"userId":"ana"}');
		const sent = new Headers(init?.headers);
		expect(sent.get("x-queue-ticket")).toBe("t1");
		expect(sent.get("x-forwarded-for")).toBe("203.0.113.9");
		expect(sent.get("content-type")).toBe("application/json");
		expect(sent.get("cookie")).toBe("session=1");
		expect(sent.get("authorization")).toBeNull();
	});

	it("sends the cookie of the shopper on, which is how the API knows who it is", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
		await proxyToBackend(
			new Request("http://web.test/api/v1/auth/me", {
				headers: { cookie: "access_token=a1; refresh_token=r1" },
			}),
			ENV,
			fetcher,
		);
		const sent = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
		expect(sent.get("cookie")).toBe("access_token=a1; refresh_token=r1");
	});

	it("gives back every cookie the API sets, each one unchanged, the refresh cookie included", async () => {
		const upstream = new Headers({ "content-type": "application/json" });
		upstream.append(
			"set-cookie",
			"access_token=a2; Path=/; Max-Age=900; HttpOnly; SameSite=Lax",
		);
		upstream.append(
			"set-cookie",
			"refresh_token=r2; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Lax; Secure",
		);
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/auth/login", {
				method: "POST",
				body: "{}",
			}),
			ENV,
			async () => new Response("{}", { headers: upstream }),
		);
		expect(reply.headers.getSetCookie()).toEqual([
			"access_token=a2; Path=/; Max-Age=900; HttpOnly; SameSite=Lax",
			"refresh_token=r2; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Lax; Secure",
		]);
	});

	it("does not rewrite the path of a cookie, whatever it is", async () => {
		const upstream = new Headers();
		upstream.append("set-cookie", "refresh_token=; Max-Age=0; Path=/auth");
		upstream.append("set-cookie", "other=1; Path=/authors; HttpOnly");
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/auth/logout", {
				method: "POST",
				body: "{}",
			}),
			ENV,
			async () => new Response("{}", { headers: upstream }),
		);
		expect(reply.headers.getSetCookie()).toEqual([
			"refresh_token=; Max-Age=0; Path=/auth",
			"other=1; Path=/authors; HttpOnly",
		]);
	});

	it("refuses a POST from another site, without asking the API", async () => {
		const fetcher = vi.fn<typeof fetch>();
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/auth/login", {
				method: "POST",
				body: "{}",
				headers: { origin: "http://evil.test", cookie: "access_token=a1" },
			}),
			ENV,
			fetcher,
		);
		expect(reply.status).toBe(403);
		expect(await reply.json()).toEqual({
			errorCode: "cross_site",
			errorMessage: "This request came from another site.",
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("does not check where a read comes from", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/sales/current", {
				headers: { origin: "http://evil.test" },
			}),
			ENV,
			fetcher,
		);
		expect(reply.status).toBe(200);
	});

	it("sends no body for a read and gives back the headers the browser needs", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response('{"a":1}', {
					status: 429,
					headers: {
						"content-type": "application/json",
						"cache-control": "public, max-age=1",
						"retry-after": "5",
						"x-secret": "no",
					},
				}),
		);
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/sales/current"),
			ENV,
			fetcher,
		);
		expect(fetcher.mock.calls[0]?.[1]?.body).toBeNull();
		expect(reply.status).toBe(429);
		expect(reply.headers.get("retry-after")).toBe("5");
		expect(reply.headers.get("cache-control")).toBe("public, max-age=1");
		expect(reply.headers.get("x-secret")).toBeNull();
		expect(await reply.json()).toEqual({ a: 1 });
	});

	it("refuses a path that is not the browser's, without asking the API", async () => {
		const fetcher = vi.fn<typeof fetch>();
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/sales/..%2Fready"),
			ENV,
			fetcher,
		);
		expect(reply.status).toBe(404);
		expect(await reply.json()).toEqual({
			errorCode: "not_found",
			errorMessage: "Nothing was found at this address.",
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each([
		["POST", "/api/sales/current", "{}"],
		["GET", "/api/auth/me", undefined],
		["POST", "/api/auth/login", "{}"],
	])(
		"refuses the unprefixed path %s %s without asking the API",
		async (method, path, body) => {
			const fetcher = vi.fn<typeof fetch>();
			const reply = await proxyToBackend(
				new Request(`http://web.test${path}`, {
					method,
					...(body === undefined ? {} : { body }),
				}),
				ENV,
				fetcher,
			);
			expect(reply.status).toBe(404);
			expect(await reply.json()).toEqual({
				errorCode: "not_found",
				errorMessage: "Nothing was found at this address.",
			});
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it.each([
		["POST", "/api/v1/admin/sales", "{}"],
		["GET", "/api/v1/admin/sales", undefined],
		["PATCH", `/api/v1/admin/sales/${ID}`, '{"stock":9}'],
		["DELETE", `/api/v1/admin/sales/${ID}`, undefined],
	])(
		"never passes the operator route %s %s on to the API",
		async (method, path, body) => {
			const fetcher = vi.fn<typeof fetch>();
			const reply = await proxyToBackend(
				new Request(`http://web.test${path}`, {
					method,
					headers: { authorization: "Bearer operator-secret-0001" },
					...(body === undefined ? {} : { body }),
				}),
				ENV,
				fetcher,
			);
			expect(reply.status).toBe(404);
			expect(await reply.json()).toEqual({
				errorCode: "not_found",
				errorMessage: "Nothing was found at this address.",
			});
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("answers 502 when the API cannot be reached", async () => {
		const reply = await proxyToBackend(
			new Request("http://web.test/api/v1/sales/current"),
			ENV,
			async () => {
				throw new TypeError("fetch failed");
			},
		);
		expect(reply.status).toBe(502);
		expect(await reply.json()).toEqual({
			errorCode: "backend_unavailable",
			errorMessage: "The API could not be reached.",
		});
	});

	it("uses the global fetch and the default address", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetcher);
		try {
			await proxyToBackend(
				new Request("http://web.test/api/v1/sales/current"),
				{},
			);
			expect(fetcher.mock.calls[0]?.[0]).toBe(
				"http://localhost:8080/api/v1/sales/current",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
