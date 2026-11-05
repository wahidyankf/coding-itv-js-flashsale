import { Err, Ok } from "@flash/typekit";
import { describe, expect, it, vi } from "vitest";
import { createSaleClient } from "./client";
import type { Watcher } from "./sse";

const SALE = "11111111-1111-4111-8111-111111111111";

function client(reply: () => Response | Promise<Response>) {
	const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => reply());
	const watch = vi.fn<Watcher>(() => () => {});
	return {
		fetcher,
		watch,
		api: createSaleClient("http://web.test", fetcher as typeof fetch, watch),
	};
}

describe("createSaleClient", () => {
	it("sends the user and gets the ticket", async () => {
		const { api, fetcher } = client(() =>
			Response.json({ ticket: "t", state: "admitted" }, { status: 201 }),
		);
		const result = await api.join(SALE, "ana");
		expect(result).toEqual(new Ok({ ticket: "t", state: "admitted" }));
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/queue`);
		expect(init?.body).toBe('{"userId":"ana"}');
	});

	it("sends the ticket as a header when it reserves", async () => {
		const { api, fetcher } = client(() => Response.json({}, { status: 201 }));
		await api.reserve(SALE, "ana", "t1");
		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.headers).toMatchObject({ "x-queue-ticket": "t1" });
	});

	it("sends the reservation id when it confirms", async () => {
		const { api, fetcher } = client(() => Response.json({}, { status: 201 }));
		await api.confirm(SALE, "ana", "r1");
		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.body).toBe('{"userId":"ana","reservationId":"r1"}');
	});

	it("encodes the user when it asks for the outcome", async () => {
		const { api, fetcher } = client(() => Response.json({ state: "none" }));
		await api.outcome(SALE, "a+b@c");
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/purchases/a%2Bb%40c`);
		expect(init?.body).toBeNull();
	});

	it("reads the error code and the wait from a refusal", async () => {
		const { api } = client(() =>
			Response.json(
				{ error: "rate_limited" },
				{ status: 429, headers: { "retry-after": "7" } },
			),
		);
		expect(await api.join(SALE, "ana")).toEqual(
			new Err({ error: "rate_limited", retryAfterSeconds: 7 }),
		);
	});

	it("reads the wait from the body when there is no header", async () => {
		const { api } = client(() =>
			Response.json(
				{ error: "rate_limited", retryAfterSeconds: 3 },
				{ status: 429 },
			),
		);
		expect(await api.join(SALE, "ana")).toEqual(
			new Err({ error: "rate_limited", retryAfterSeconds: 3 }),
		);
	});

	it("calls an answer it cannot read unexpected", async () => {
		const { api } = client(() => new Response("<html>", { status: 500 }));
		expect(await api.join(SALE, "ana")).toEqual(
			new Err({ error: "unexpected", retryAfterSeconds: undefined }),
		);
	});

	it("calls an error without a code unexpected", async () => {
		const { api } = client(() => Response.json({ error: 5 }, { status: 400 }));
		expect(await api.join(SALE, "ana")).toEqual(
			new Err({ error: "unexpected", retryAfterSeconds: undefined }),
		);
	});

	it("reports the network when nothing answers", async () => {
		const { api } = client(() => {
			throw new TypeError("fetch failed");
		});
		expect(await api.join(SALE, "ana")).toEqual(new Err({ error: "network" }));
	});

	it("reads a good answer that has no body", async () => {
		const { api } = client(() => new Response(null, { status: 200 }));
		expect(await api.outcome(SALE, "ana")).toEqual(new Ok({}));
	});

	it("hands only sale events to the sale callback", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchSale(SALE, (sale) => seen.push(sale));
		const onEvent = watch.mock.calls[0]?.[1];
		expect(watch.mock.calls[0]?.[0]).toBe(
			`http://web.test/api/sales/${SALE}/events`,
		);
		onEvent?.("place", { state: "admitted" });
		onEvent?.("sale", { remaining: 2 });
		expect(seen).toEqual([{ remaining: 2 }]);
	});

	it("hands only place events to the place callback, with the ticket", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchPlace(SALE, "a b", "t1", (place) => seen.push(place));
		const [url, onEvent, headers] = watch.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/queue/a%20b/events`);
		expect(headers).toEqual({ "x-queue-ticket": "t1" });
		onEvent?.("sale", { remaining: 2 });
		onEvent?.("place", { state: "admitted" });
		expect(seen).toEqual([{ state: "admitted" }]);
	});

	it("works with the defaults", () => {
		expect(typeof createSaleClient().join).toBe("function");
	});
});
