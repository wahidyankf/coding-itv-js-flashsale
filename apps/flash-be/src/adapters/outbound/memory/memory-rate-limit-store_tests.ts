// Unit tests for the local rate-limit counter that counts while Redis is down. The window starts at the first hit, and a
// window that has ended starts again, whether or not a sweep has already dropped it.
import { describe, expect, it } from "vitest";
import { createMemoryRateLimitStore } from "./memory-rate-limit-store.js";

const T0 = new Date("2026-06-01T12:00:00Z");
const WINDOW_MS = 1000;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("the local rate-limit counter", () => {
	it("counts the hits of one window, from the first hit", async () => {
		const store = createMemoryRateLimitStore();
		expect(await store.hit("k", WINDOW_MS, T0)).toEqual({
			count: 1,
			resetInMs: WINDOW_MS,
		});
		expect(await store.hit("k", WINDOW_MS, at(300))).toEqual({
			count: 2,
			resetInMs: 700,
		});
	});

	it("starts a new window once the old one has ended", async () => {
		const store = createMemoryRateLimitStore();
		await store.hit("k", WINDOW_MS, T0);
		await store.hit("k", WINDOW_MS, at(500));
		expect(await store.hit("k", WINDOW_MS, at(WINDOW_MS))).toEqual({
			count: 1,
			resetInMs: WINDOW_MS,
		});
	});

	// A sweep runs at most once per window, so an ended window can wait unswept for a while. It must still restart at once.
	it("starts a new window for a key whose window ended, even before a sweep dropped it", async () => {
		const store = createMemoryRateLimitStore();
		await store.hit("sweeper", 5 * WINDOW_MS, T0);
		await store.hit("k", WINDOW_MS, T0);
		expect(await store.hit("k", WINDOW_MS, at(2 * WINDOW_MS))).toEqual({
			count: 1,
			resetInMs: WINDOW_MS,
		});
	});

	it("keeps the count of each key apart", async () => {
		const store = createMemoryRateLimitStore();
		await store.hit("a", WINDOW_MS, T0);
		expect(await store.hit("b", WINDOW_MS, T0)).toEqual({
			count: 1,
			resetInMs: WINDOW_MS,
		});
	});
});
