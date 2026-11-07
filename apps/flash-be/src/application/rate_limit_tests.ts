import { describe, expect, it } from "vitest";
import { createMemoryRateLimitStore } from "../adapters/outbound/memory/memory-rate-limit-store.js";
import type { RateLimitStore } from "./ports/rate-limit-store.js";
import { createRateLimiter } from "./rate-limiter.js";

// Rules at the edges that the scenarios do not show: the in-process copy, the Redis outage, and odd requests.
const START = new Date("2026-06-01T12:00:00Z");
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);

describe("the in-process rate limit store", () => {
	it("counts hits inside a window that starts at the first hit", async () => {
		const store = createMemoryRateLimitStore();
		expect(await store.hit("k", 10_000, at(3))).toEqual({
			count: 1,
			resetInMs: 10_000,
		});
		expect(await store.hit("k", 10_000, at(8))).toEqual({
			count: 2,
			resetInMs: 5_000,
		});
	});

	it("starts again when the window is over, and counts keys apart", async () => {
		const store = createMemoryRateLimitStore();
		await store.hit("k", 10_000, at(0));
		await store.hit("other", 10_000, at(0));
		expect((await store.hit("k", 10_000, at(10))).count).toBe(1);
		expect((await store.hit("other", 10_000, at(5))).count).toBe(1);
	});
});

describe("the rate limiter", () => {
	const broken: RateLimitStore = {
		hit: async () => {
			throw new Error("redis is down");
		},
	};

	it("counts in the process when Redis fails, so the limit stays on", async () => {
		const limiter = createRateLimiter(
			broken,
			createMemoryRateLimitStore(),
			() => START,
			{ windowSeconds: 10, perUser: 2, perIp: 100, authPerIp: 100 },
		);
		const ask = () =>
			limiter.check({ saleId: "s", user: "ana", ip: "1.1.1.1" });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toEqual({ limited: true, retryAfterSeconds: 10 });
	});

	it("counts a request with no usable user id against its address only", async () => {
		const limiter = createRateLimiter(
			createMemoryRateLimitStore(),
			createMemoryRateLimitStore(),
			() => START,
			{ windowSeconds: 10, perUser: 1, perIp: 2, authPerIp: 100 },
		);
		const ask = () =>
			limiter.check({ saleId: "s", user: "has space", ip: "1.1.1.1" });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toMatchObject({ limited: true });
	});

	it("asks the client to wait at least one second", async () => {
		const store: RateLimitStore = {
			hit: async () => ({ count: 99, resetInMs: 200 }),
		};
		const limiter = createRateLimiter(store, store, () => START, {
			windowSeconds: 1,
			perUser: 1,
			perIp: 1,
			authPerIp: 1,
		});
		expect(
			await limiter.check({ saleId: "s", user: "ana", ip: "1.1.1.1" }),
		).toEqual({ limited: true, retryAfterSeconds: 1 });
	});

	it("limits the auth routes by address with a limit of their own, apart from any sale", async () => {
		const limiter = createRateLimiter(
			createMemoryRateLimitStore(),
			createMemoryRateLimitStore(),
			() => START,
			{ windowSeconds: 10, perUser: 100, perIp: 100, authPerIp: 2 },
		);
		const ask = () => limiter.checkAuth({ ip: "1.1.1.1" });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toEqual({ limited: false });
		expect(await ask()).toEqual({ limited: true, retryAfterSeconds: 10 });
		expect(await limiter.checkAuth({ ip: "2.2.2.2" })).toEqual({
			limited: false,
		});
		// A sale has its own count.
		expect(
			await limiter.check({ saleId: "s", user: "ana", ip: "1.1.1.1" }),
		).toEqual({ limited: false });
	});
});
