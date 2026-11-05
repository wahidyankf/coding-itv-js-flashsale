import { expect, it } from "vitest";
import { fakeSale } from "../bdd/support/fake-sales.js";
import type { SaleRepository } from "./ports/sale-repository.js";
import { createCachedSaleRepository } from "./sale-cache.js";

// Rules at the edges that the scenarios do not show: one shared read, copies, and turning the cache off.
const START = new Date("2026-06-01T12:00:00Z");

function counting(sale = fakeSale({})) {
	const reads = { byId: 0, current: 0 };
	const inner: SaleRepository = {
		findById: async () => {
			reads.byId++;
			await Promise.resolve();
			return { ...sale };
		},
		findCurrent: async () => {
			reads.current++;
			await Promise.resolve();
			return { ...sale };
		},
	};
	return { inner, reads, sale };
}

it("shares one read between callers that arrive while it runs", async () => {
	const { inner, reads, sale } = counting();
	const cache = createCachedSaleRepository(inner, { ttlMs: 1000 }, () => START);
	const answers = await Promise.all(
		Array.from({ length: 20 }, () => cache.findById(sale.id)),
	);
	expect(reads.byId).toBe(1);
	expect(answers.every((answer) => answer?.id === sale.id)).toBe(true);
});

it("reads again once the time is over, for one sale and for the current sale", async () => {
	let now = START;
	const { inner, reads, sale } = counting();
	const cache = createCachedSaleRepository(inner, { ttlMs: 1000 }, () => now);
	await cache.findById(sale.id);
	await cache.findCurrent();
	await cache.findById(sale.id);
	await cache.findCurrent();
	expect(reads).toEqual({ byId: 1, current: 1 });
	now = new Date(START.getTime() + 1000);
	await cache.findById(sale.id);
	await cache.findCurrent();
	expect(reads).toEqual({ byId: 2, current: 2 });
});

it("keeps nothing when the sale is not found", async () => {
	let reads = 0;
	const inner: SaleRepository = {
		findById: async () => {
			reads++;
			return undefined;
		},
		findCurrent: async () => {
			reads++;
			return undefined;
		},
	};
	const cache = createCachedSaleRepository(inner, { ttlMs: 1000 }, () => START);
	await cache.findById("a");
	await cache.findById("a");
	await cache.findCurrent();
	await cache.findCurrent();
	expect(reads).toBe(4);
});

it("goes to the repository every time when the time is zero, and forgets what it kept", async () => {
	const settings = { ttlMs: 1000 };
	const { inner, reads, sale } = counting();
	const cache = createCachedSaleRepository(inner, settings, () => START);
	await cache.findById(sale.id);
	settings.ttlMs = 0;
	await cache.findById(sale.id);
	await cache.findById(sale.id);
	await cache.findCurrent();
	await cache.findCurrent();
	expect(reads).toEqual({ byId: 3, current: 2 });
	settings.ttlMs = 1000;
	await cache.findById(sale.id);
	expect(reads.byId).toBe(4);
});
