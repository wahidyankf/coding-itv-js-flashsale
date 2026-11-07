// Unit tests for the sale client: each call's path, method and headers, and how each answer is read.
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it, vi } from "vitest";
import type { Reporter } from "../decode-report";
import { createSaleClient } from "./client";
import type { Watcher } from "./sse";

const unexpected = new Err({
	errorCode: "unexpected",
	errorMessage: "The server sent a reply that this app cannot read.",
});
const rateLimited = {
	errorCode: "rate_limited",
	errorMessage: "Too many requests. Try again later.",
};

const SALE = "11111111-1111-4111-8111-111111111111";
const RESERVATION = "33333333-3333-4333-8333-333333333333";
const PURCHASE_ID = "44444444-4444-4444-8444-444444444444";
const WHEN = "2026-06-01T12:00:00.000Z";

const JOINED = { userId: "ana", ticket: "t", state: "admitted" } as const;
const RESERVED = { userId: "ana", reservationId: RESERVATION, expiresAt: WHEN };
const PURCHASE = {
	userId: "ana",
	purchaseId: PURCHASE_ID,
	reservationId: RESERVATION,
	purchasedAt: WHEN,
};
const SALE_VIEW = {
	id: SALE,
	productId: "22222222-2222-4222-8222-222222222222",
	name: "Drop",
	status: "active",
	startsAt: WHEN,
	endsAt: WHEN,
	stock: 10,
	remaining: 2,
} as const;

function client(
	reply: () => Response | Promise<Response>,
	report = vi.fn<Reporter>(),
) {
	const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => reply());
	const watch = vi.fn<Watcher>(() => () => {});
	return {
		fetcher,
		watch,
		report,
		api: createSaleClient(
			"http://web.test",
			fetcher as typeof fetch,
			watch,
			report,
		),
	};
}

describe("createSaleClient", () => {
	it("gets the ticket, and names nobody: the cookie does", async () => {
		const { api, fetcher } = client(() =>
			Response.json(JOINED, { status: 201 }),
		);
		const result = await api.join(SALE);
		expect(result).toEqual(new Ok(JOINED));
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/queue`);
		expect(init?.body).toBe("{}");
	});

	it("sends the ticket as a header when it reserves", async () => {
		const { api, fetcher } = client(() =>
			Response.json(RESERVED, { status: 201 }),
		);
		expect(await api.reserve(SALE, "t1")).toEqual(new Ok(RESERVED));
		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.headers).toMatchObject({ "x-queue-ticket": "t1" });
	});

	it("sends the reservation id when it confirms", async () => {
		const { api, fetcher } = client(() =>
			Response.json(PURCHASE, { status: 201 }),
		);
		expect(await api.confirm(SALE, "r1")).toEqual(new Ok(PURCHASE));
		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.body).toBe('{"reservationId":"r1"}');
	});

	it("asks for the outcome of the shopper who is logged in", async () => {
		const { api, fetcher } = client(() =>
			Response.json({ userId: "ana", state: "none" }),
		);
		await api.outcome(SALE);
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/purchases/me`);
		expect(init?.body).toBeUndefined();
	});

	it("reads the error code and the wait from a refusal", async () => {
		const { api } = client(() =>
			Response.json(
				{ ...rateLimited, retryAfterSeconds: 9 },
				{ status: 429, headers: { "retry-after": "7" } },
			),
		);
		expect(await api.join(SALE)).toEqual(
			new Err({ ...rateLimited, retryAfterSeconds: 7 }),
		);
	});

	it("reads the wait from the body when there is no header", async () => {
		const { api } = client(() =>
			Response.json({ ...rateLimited, retryAfterSeconds: 3 }, { status: 429 }),
		);
		expect(await api.join(SALE)).toEqual(
			new Err({ ...rateLimited, retryAfterSeconds: 3 }),
		);
	});

	it("calls an answer it cannot read unexpected", async () => {
		const { api } = client(() => new Response("<html>", { status: 500 }));
		expect(await api.join(SALE)).toEqual(unexpected);
	});

	it("calls an error without a code unexpected", async () => {
		const { api } = client(() =>
			Response.json({ errorCode: 5 }, { status: 400 }),
		);
		expect(await api.join(SALE)).toEqual(unexpected);
	});

	it("reports the network when nothing answers", async () => {
		const { api } = client(() => {
			throw new TypeError("fetch failed");
		});
		expect(await api.join(SALE)).toEqual(
			new Err({
				errorCode: "network",
				errorMessage: "The server could not be reached.",
			}),
		);
	});

	it("calls a good answer that has no body unexpected", async () => {
		const { api } = client(() => new Response(null, { status: 200 }));
		expect(await api.outcome(SALE)).toEqual(unexpected);
	});

	it("hands only sale events to the sale callback", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchSale(
			SALE,
			(sale) => seen.push(sale),
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(watch.mock.calls[0]?.[0]).toBe(
			`http://web.test/api/sales/${SALE}/events`,
		);
		onEvent?.("place", { userId: "ana", state: "admitted" });
		onEvent?.("sale", SALE_VIEW);
		expect(seen).toEqual([SALE_VIEW]);
	});

	it("hands only place events to the place callback, with the ticket", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchPlace(
			SALE,
			"t1",
			(place) => seen.push(place),
			() => {},
		);
		const [url, onEvent, subscription] = watch.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test/api/sales/${SALE}/queue/me/events`);
		expect(subscription?.headers).toEqual({ "x-queue-ticket": "t1" });
		onEvent?.("sale", SALE_VIEW);
		onEvent?.("place", { userId: "ana", state: "admitted" });
		expect(seen).toEqual([{ userId: "ana", state: "admitted" }]);
	});

	it("passes the give-up of each stream on to the watcher", () => {
		const { api, watch } = client(() => Response.json({}));
		const giveUpSale = vi.fn();
		const giveUpPlace = vi.fn();
		api.watchSale(SALE, () => {}, giveUpSale);
		api.watchPlace(SALE, "t1", () => {}, giveUpPlace);
		watch.mock.calls[0]?.[2]?.onGiveUp?.();
		watch.mock.calls[1]?.[2]?.onGiveUp?.();
		expect(giveUpSale).toHaveBeenCalledOnce();
		expect(giveUpPlace).toHaveBeenCalledOnce();
	});

	it("calls a join reply that does not decode unexpected", async () => {
		const { api } = client(() =>
			Response.json({ userId: "ana", ticket: "t" }, { status: 201 }),
		);
		expect(await api.join(SALE)).toEqual(unexpected);
	});

	it("calls a reservation with a bad expiry unexpected", async () => {
		const { api } = client(() =>
			Response.json(
				{ userId: "ana", reservationId: RESERVATION, expiresAt: "soon" },
				{ status: 201 },
			),
		);
		expect(await api.reserve(SALE, "t1")).toEqual(unexpected);
	});

	it("passes a sale frame on only when it decodes, and says it was used", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchSale(
			SALE,
			(sale) => seen.push(sale),
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(onEvent?.("sale", { ...SALE_VIEW, stock: "10" })).toBe(false);
		expect(onEvent?.("sale", SALE_VIEW)).toBe(true);
		expect(seen).toEqual([SALE_VIEW]);
	});

	it("drops a place frame that does not decode, and does not count it as used", () => {
		const { api, watch } = client(() => Response.json({}));
		const seen: unknown[] = [];
		api.watchPlace(
			SALE,
			"t1",
			(place) => seen.push(place),
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(onEvent?.("place", { userId: "ana", state: "waiting" })).toBe(false);
		expect(onEvent?.("place", { userId: "ana", state: "admitted" })).toBe(true);
		expect(seen).toEqual([{ userId: "ana", state: "admitted" }]);
	});

	it("works with the defaults", () => {
		expect(typeof createSaleClient().join).toBe("function");
	});
});

describe("createSaleClient, what it reports", () => {
	it("reports a reply that does not decode, with its URL, once", async () => {
		const { api, report } = client(() =>
			Response.json({ userId: "ana", ticket: "t" }, { status: 201 }),
		);
		await api.join(SALE);
		expect(report).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({
				source: `http://web.test/api/sales/${SALE}/queue`,
				path: "state",
			}),
		);
	});

	it("reports a sale frame that does not decode, with its stream and event, and says it was not used", () => {
		const { api, watch, report } = client(() => Response.json({}));
		api.watchSale(
			SALE,
			() => {},
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(onEvent?.("sale", { ...SALE_VIEW, stock: "10" })).toBe(false);
		expect(report).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith({
			source: `http://web.test/api/sales/${SALE}/events event sale`,
			path: "stock",
			expected: "a non-negative integer",
		});
	});

	it("reports a place frame that does not decode, with its event name", () => {
		const { api, watch, report } = client(() => Response.json({}));
		api.watchPlace(
			SALE,
			"t1",
			() => {},
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(onEvent?.("place", { userId: "ana", state: "waiting" })).toBe(false);
		expect(report).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith({
			source: `http://web.test/api/sales/${SALE}/queue/me/events event place`,
			path: "place",
			expected: "an integer",
		});
	});

	it("reports nothing for a frame that decodes, or for an event the stream does not use", () => {
		const { api, watch, report } = client(() => Response.json({}));
		api.watchSale(
			SALE,
			() => {},
			() => {},
		);
		const onEvent = watch.mock.calls[0]?.[1];
		expect(onEvent?.("sale", SALE_VIEW)).toBe(true);
		expect(onEvent?.("place", { userId: "ana", state: "waiting" })).toBe(false);
		expect(report).not.toHaveBeenCalled();
	});
});
