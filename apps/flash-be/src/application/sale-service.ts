// Reads of sales for the shoppers and for the write routes. The public reads may come from a short cache; `details`,
// which the write routes decide on, is always read fresh.
import { Err, Ok, type Result } from "@flash/typekit";
import {
	isSaleId,
	type Sale,
	type SaleStatus,
	saleStatus,
} from "../domain/sale.js";
import type { Clock } from "./ports/clock.js";
import type { SaleRepository } from "./ports/sale-repository.js";
import {
	createCachedSaleRepository,
	type SaleCacheSettings,
} from "./sale-cache.js";
import { describeSale, type SaleView } from "./sale-view.js";

export type SaleService = {
	// How long public reads may be cached, in milliseconds. Zero means not at all.
	cacheMs: () => number;
	// The sale shoppers are shown now, as the public view. It may be up to `cacheMs` old.
	current: () => Promise<SaleView | undefined>;
	// The public view of one sale. It may be up to `cacheMs` old.
	byId: (id: string) => Promise<SaleView | undefined>;
	// The sale itself, read fresh, for the rules that decide a write.
	details: (id: string) => Promise<Sale | undefined>;
};

// A malformed id can never match a row, so the store is not asked for one.
async function lookup(
	id: string,
	read: (id: string) => Promise<Sale | undefined>,
): Promise<Sale | undefined> {
	return isSaleId(id) ? read(id) : undefined;
}

// The sale a write may act on: it exists, and its status does not block the action. When it cannot, the first reason
// is the answer. The block rules themselves (reserveBlock, queueBlock) live in the domain.
export function actionableSale<B extends string>(
	found: Sale | undefined,
	now: Date,
	blockOf: (status: SaleStatus) => B | undefined,
): Result<Sale, "sale_not_found" | B> {
	if (found === undefined) return new Err("sale_not_found");
	const block = blockOf(saleStatus(found, now));
	return block === undefined ? new Ok(found) : new Err(block);
}

// The sale reads. The cache setting is the one knob the server or a scenario turns: zero means no cache.
export function createSaleService(
	repository: SaleRepository,
	clock: Clock,
	cache: SaleCacheSettings = { ttlMs: 0 },
): SaleService {
	const reads = createCachedSaleRepository(repository, cache, clock);
	const viewOf = (sale: Sale | undefined): SaleView | undefined =>
		sale === undefined ? undefined : describeSale(sale, clock());

	return {
		cacheMs: () => cache.ttlMs,
		current: async () => viewOf(await reads.findCurrent(clock())),
		byId: async (id) => viewOf(await lookup(id, reads.findById)),
		details: (id) => lookup(id, repository.findById),
	};
}
