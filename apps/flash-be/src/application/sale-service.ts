// Reads of sales for the shoppers and for the write routes (application layer). The public reads may come from a short
// cache; `details`, which the write routes decide on, is always read fresh. The service returns the sale and its status;
// the HTTP adapter builds the wire view from them.
import { Err, Ok, type Result } from "@flash/typekit";
import {
	isUuid,
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

// A sale with its status at one moment. The status is worked out from the window and the stock at that moment.
export type SaleWithStatus = { sale: Sale; status: SaleStatus };

// The sale paired with its status at `now`.
export function withStatus(sale: Sale, now: Date): SaleWithStatus {
	return { sale, status: saleStatus(sale, now) };
}

// Reads of sales for the shoppers and the write routes. A public read may be up to the cache time old; the details the
// write routes decide on are always fresh.
export type SaleService = {
	// The sale shoppers are shown now, with its status. It may be up to the cache time old.
	current: () => Promise<SaleWithStatus | undefined>;
	// One sale with its status. It may be up to the cache time old.
	byId: (id: string) => Promise<SaleWithStatus | undefined>;
	// The sale itself, read fresh, for the rules that decide a write.
	details: (id: string) => Promise<Sale | undefined>;
};

// A malformed id can never match a row, so it is refused here, before any store is asked. The id, or `sale_not_found`.
export function saleIdOf(id: string): Result<string, "sale_not_found"> {
	return isUuid(id) ? new Ok(id) : new Err("sale_not_found");
}

// Reads the sale with this id, unless the id is malformed: then the store is not asked.
async function lookup(
	id: string,
	read: (id: string) => Promise<Sale | undefined>,
): Promise<Sale | undefined> {
	const known = saleIdOf(id);
	return known.isOk() ? read(known.value) : undefined;
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

// The sale reads. The cache setting is the one knob the server or a scenario turns: zero means no cache. Every part is
// passed in, so a test chooses the cache it reads through.
export function createSaleService(
	repository: SaleRepository,
	clock: Clock,
	cache: SaleCacheSettings,
): SaleService {
	const reads = createCachedSaleRepository(repository, cache, clock);
	const statused = (sale: Sale | undefined): SaleWithStatus | undefined =>
		sale === undefined ? undefined : withStatus(sale, clock());

	return {
		current: async () => statused(await reads.findCurrent(clock())),
		byId: async (id) => statused(await lookup(id, reads.findById)),
		details: (id) => lookup(id, repository.findById),
	};
}
