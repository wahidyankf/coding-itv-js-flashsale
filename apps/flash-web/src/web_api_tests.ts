// Unit tests for the web API wiring: one shared login refresh, and the listeners for a lost login.
import { describe, expect, it, vi } from "vitest";
import { createWebApi, withRefresh } from "./web-api";

const BASE = "http://web.test";

const unauthenticated = () =>
	Response.json(
		{ errorCode: "not_authenticated", errorMessage: "no" },
		{ status: 401 },
	);
const refreshed = () => Response.json({ username: "ana", role: "shopper" });
const refused = () =>
	Response.json(
		{ errorCode: "invalid_refresh_token", errorMessage: "no" },
		{ status: 401 },
	);

// Answers each call from a queue, per address.
function fetcherOf(answers: Record<string, Array<() => Response>>) {
	return vi.fn(async (input: unknown, _init?: RequestInit) => {
		const next = answers[String(input).replace(BASE, "")]?.shift();
		if (next === undefined) throw new Error(`no answer for ${String(input)}`);
		return next();
	});
}

describe("withRefresh", () => {
	it("passes an ordinary reply through", async () => {
		const fetcher = fetcherOf({ "/api/a": [() => Response.json({ n: 1 })] });
		const onExpired = vi.fn();
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, onExpired);
		const reply = await wrapped(`${BASE}/api/a`);
		expect(await reply.json()).toEqual({ n: 1 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(onExpired).not.toHaveBeenCalled();
	});

	it("trades the refresh token and asks again when the login is gone", async () => {
		const fetcher = fetcherOf({
			"/api/a": [unauthenticated, () => Response.json({ n: 2 })],
			"/api/v1/auth/refresh": [refreshed],
		});
		const onExpired = vi.fn();
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, onExpired);
		const reply = await wrapped(`${BASE}/api/a`, {
			method: "POST",
			body: "{}",
		});
		expect(await reply.json()).toEqual({ n: 2 });
		expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
			`${BASE}/api/a`,
			`${BASE}/api/v1/auth/refresh`,
			`${BASE}/api/a`,
		]);
		expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
		// The same request, body included, is sent again.
		expect(fetcher.mock.calls[2]?.[1]?.body).toBe("{}");
		expect(onExpired).not.toHaveBeenCalled();
	});

	it("gives the first reply back, and says the login ended, when the refresh is refused", async () => {
		const fetcher = fetcherOf({
			"/api/a": [unauthenticated],
			"/api/v1/auth/refresh": [refused],
		});
		const onExpired = vi.fn();
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, onExpired);
		const reply = await wrapped(`${BASE}/api/a`);
		expect(reply.status).toBe(401);
		expect(onExpired).toHaveBeenCalledOnce();
	});

	it.each([
		[
			"another 401",
			() =>
				Response.json(
					{ errorCode: "invalid_ticket", errorMessage: "x" },
					{ status: 401 },
				),
		],
		["a 401 that is not JSON", () => new Response("no", { status: 401 })],
		[
			"a 403",
			() =>
				Response.json(
					{ errorCode: "forbidden", errorMessage: "x" },
					{ status: 403 },
				),
		],
		[
			"a 401 that names no sentence",
			() => Response.json({ errorCode: "not_authenticated" }, { status: 401 }),
		],
		[
			"a 401 whose body cannot be read",
			() =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.error(new TypeError("connection reset"));
						},
					}),
					{ status: 401 },
				),
		],
		["a 500", () => new Response("no", { status: 500 })],
	])("does not refresh for %s", async (_name, answer) => {
		const fetcher = fetcherOf({ "/api/a": [answer] });
		const onExpired = vi.fn();
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, onExpired);
		await wrapped(`${BASE}/api/a`);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(onExpired).not.toHaveBeenCalled();
	});

	it("shares one refresh between requests that fail together, because a refresh token works once", async () => {
		const fetcher = fetcherOf({
			"/api/a": [unauthenticated, () => Response.json({})],
			"/api/b": [unauthenticated, () => Response.json({})],
			"/api/v1/auth/refresh": [refreshed],
		});
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, vi.fn());
		await Promise.all([wrapped(`${BASE}/api/a`), wrapped(`${BASE}/api/b`)]);
		const refreshes = fetcher.mock.calls.filter(([url]) =>
			String(url).endsWith("/api/v1/auth/refresh"),
		);
		expect(refreshes).toHaveLength(1);
	});

	it("refreshes again for a later request", async () => {
		const fetcher = fetcherOf({
			"/api/a": [
				unauthenticated,
				() => Response.json({}),
				unauthenticated,
				() => Response.json({}),
			],
			"/api/v1/auth/refresh": [refreshed, refreshed],
		});
		const wrapped = withRefresh(BASE, fetcher as typeof fetch, vi.fn());
		await wrapped(`${BASE}/api/a`);
		await wrapped(`${BASE}/api/a`);
		const refreshes = fetcher.mock.calls.filter(([url]) =>
			String(url).endsWith("/api/v1/auth/refresh"),
		);
		expect(refreshes).toHaveLength(2);
	});
});

// The place stream of the sale "s", as the page opens it.
const PLACE_STREAM = "/api/v1/sales/s/queue/me/events";
// One place frame, as flash-be sends it, in a body that ends after it.
const placeStream = () =>
	new Response(
		'event: place\ndata: {"userId":"ana","state":"waiting","place":3}\n\n',
	);
// The same frame on a stream that stays open, as the real one does until the connection drops.
const openPlaceStream = () =>
	new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'event: place\ndata: {"userId":"ana","state":"waiting","place":3}\n\n',
					),
				);
			},
		}),
	);
const stillWaiting = { userId: "ana", state: "waiting", place: 3 };
const noWait = async () => {};

describe("the live streams of createWebApi", () => {
	it("renews the login once when a stream is opened again after the access token ran out, then keeps reading", async () => {
		const fetcher = fetcherOf({
			[PLACE_STREAM]: [placeStream, unauthenticated, openPlaceStream],
			"/api/v1/auth/refresh": [refreshed],
		});
		const api = createWebApi(BASE, fetcher as typeof fetch, {
			live: { sleep: noWait, random: () => 0 },
		});
		const places: unknown[] = [];
		const onGiveUp = vi.fn();
		const stop = api.sale.watchPlace(
			"s",
			"t",
			(place) => places.push(place),
			onGiveUp,
		);
		await vi.waitFor(() => expect(places).toHaveLength(2));
		stop();
		expect(places[1]).toEqual(stillWaiting);
		const refreshes = fetcher.mock.calls.filter(([url]) =>
			String(url).endsWith("/api/v1/auth/refresh"),
		);
		expect(refreshes).toHaveLength(1);
		expect(onGiveUp).not.toHaveBeenCalled();
	});

	it("tells the page the login ended, and stops without a notice of its own, when the refresh is refused", async () => {
		const fetcher = fetcherOf({
			[PLACE_STREAM]: [unauthenticated],
			"/api/v1/auth/refresh": [refused],
		});
		const api = createWebApi(BASE, fetcher as typeof fetch, {
			live: { sleep: noWait, random: () => 0 },
		});
		const expired = vi.fn();
		api.onExpired(expired);
		const onGiveUp = vi.fn();
		api.sale.watchPlace("s", "t", () => {}, onGiveUp);
		await vi.waitFor(() => expect(expired).toHaveBeenCalledOnce());
		await noWait();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(onGiveUp).not.toHaveBeenCalled();
	});

	it("tells the page the login ended when the stream is refused again after a good refresh", async () => {
		const fetcher = fetcherOf({
			[PLACE_STREAM]: [unauthenticated, unauthenticated],
			"/api/v1/auth/refresh": [refreshed],
		});
		const api = createWebApi(BASE, fetcher as typeof fetch, {
			live: { sleep: noWait, random: () => 0 },
		});
		const expired = vi.fn();
		api.onExpired(expired);
		const onGiveUp = vi.fn();
		api.sale.watchPlace("s", "t", () => {}, onGiveUp);
		await vi.waitFor(() => expect(expired).toHaveBeenCalledOnce());
		expect(onGiveUp).not.toHaveBeenCalled();
	});

	it("reports the give-up when the place stream is refused for a gone sale", async () => {
		const fetcher = fetcherOf({
			[PLACE_STREAM]: [
				() =>
					Response.json(
						{ errorCode: "sale_not_found", errorMessage: "x" },
						{ status: 404 },
					),
			],
		});
		const api = createWebApi(BASE, fetcher as typeof fetch, {
			live: { sleep: noWait, random: () => 0 },
		});
		const onGiveUp = vi.fn();
		api.sale.watchPlace("s", "t", () => {}, onGiveUp);
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe("createWebApi", () => {
	it("tells every listener that the login ended, until it stops listening", async () => {
		const fetcher = fetcherOf({
			"/api/v1/sales/s/purchases/me": [unauthenticated, unauthenticated],
			"/api/v1/auth/refresh": [refused, refused],
		});
		const api = createWebApi(BASE, fetcher as typeof fetch, {
			watch: () => () => {},
		});
		const first = vi.fn();
		const second = vi.fn();
		api.onExpired(first);
		const stopSecond = api.onExpired(second);
		await api.sale.outcome("s");
		expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
		stopSecond();
		await api.sale.outcome("s");
		expect([first.mock.calls.length, second.mock.calls.length]).toEqual([2, 1]);
	});

	it("builds its own watcher when none is given", () => {
		expect(
			typeof createWebApi(BASE, vi.fn() as unknown as typeof fetch).sale
				.watchSale,
		).toBe("function");
	});

	it("works with the defaults", () => {
		expect(typeof createWebApi().auth.me).toBe("function");
	});
});
