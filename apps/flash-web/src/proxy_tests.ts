import { describe, expect, it, vi } from "vitest";
import { isAllowed, proxyToBackend } from "./proxy";

const ENV = { FLASH_BE_URL: "http://flash-be.test" };
const ID = "11111111-1111-4111-8111-111111111111";

describe("isAllowed", () => {
	it.each([
		["GET", "current"],
		["GET", ID],
		["GET", `${ID}/events`],
		["POST", `${ID}/queue`],
		["GET", `${ID}/queue/ana`],
		["GET", `${ID}/queue/ana/events`],
		["POST", `${ID}/reservations`],
		["POST", `${ID}/purchases`],
		["GET", `${ID}/purchases/a%2Bb%40c`],
	])("lets %s %s through", (method, path) => {
		expect(isAllowed(method, path)).toBe(true);
	});

	it.each([
		["POST", "current"],
		["GET", `${ID}/queue`],
		["GET", `${ID}/reservations`],
		["DELETE", ID],
		["GET", "../ready"],
		["GET", `${ID}/purchases/a/b`],
		["GET", "not-a-sale-id"],
	])("refuses %s %s", (method, path) => {
		expect(isAllowed(method, path)).toBe(false);
	});
});

describe("proxyToBackend", () => {
	it("passes on only the headers the API needs", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response("{}", { headers: { "x-secret": "no" } }),
		);
		await proxyToBackend(
			new Request(`http://web.test/api/sales/${ID}/reservations`, {
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
		expect(url).toBe(`http://flash-be.test/sales/${ID}/reservations`);
		expect(init?.body).toBe('{"userId":"ana"}');
		const sent = new Headers(init?.headers);
		expect(sent.get("x-queue-ticket")).toBe("t1");
		expect(sent.get("x-forwarded-for")).toBe("203.0.113.9");
		expect(sent.get("content-type")).toBe("application/json");
		expect(sent.get("cookie")).toBeNull();
		expect(sent.get("authorization")).toBeNull();
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
			new Request("http://web.test/api/sales/current"),
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
			new Request("http://web.test/api/sales/..%2Fready"),
			ENV,
			fetcher,
		);
		expect(reply.status).toBe(404);
		expect(await reply.json()).toEqual({ error: "not_found" });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("answers 502 when the API cannot be reached", async () => {
		const reply = await proxyToBackend(
			new Request("http://web.test/api/sales/current"),
			ENV,
			async () => {
				throw new TypeError("fetch failed");
			},
		);
		expect(reply.status).toBe(502);
		expect(await reply.json()).toEqual({ error: "backend_unavailable" });
	});

	it("uses the global fetch and the default address", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetcher);
		try {
			await proxyToBackend(
				new Request("http://web.test/api/sales/current"),
				{},
			);
			expect(fetcher.mock.calls[0]?.[0]).toBe(
				"http://localhost:8080/sales/current",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
