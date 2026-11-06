import { isSaleId, type Sale } from "../domain/sale.js";
import type { Clock } from "./ports/clock.js";
import type { SaleRepository } from "./ports/sale-repository.js";
import {
	createCachedSaleRepository,
	type SaleCacheSettings,
} from "./sale-cache.js";
import { describeSale, type SaleView } from "./sale-view.js";

// The sale with its rules (hold time, admission rate) next to the public view.
export type SaleDetails = { sale: Sale; view: SaleView };

export type SaleService = {
	// How long public reads may be cached, in milliseconds. Zero means not at all.
	cacheMs: () => number;
	// The public reads. They may be up to `cacheMs` old.
	current: () => Promise<SaleView | undefined>;
	byId: (id: string) => Promise<SaleView | undefined>;
	// Always fresh, because the write routes decide on it.
	details: (id: string) => Promise<SaleDetails | undefined>;
};

export function createSaleService(
	repository: SaleRepository,
	clock: Clock,
	cache: SaleCacheSettings = { ttlMs: 0 },
): SaleService {
	const reads = createCachedSaleRepository(repository, cache, clock);
	const view = (sale: Sale): SaleView => describeSale(sale, clock());

	return {
		cacheMs: () => cache.ttlMs,
		current: async () => {
			const sale = await reads.findCurrent();
			return sale === undefined ? undefined : view(sale);
		},
		byId: async (id) => {
			if (!isSaleId(id)) return undefined;
			const sale = await reads.findById(id);
			return sale === undefined ? undefined : view(sale);
		},
		details: async (id) => {
			if (!isSaleId(id)) return undefined;
			const sale = await repository.findById(id);
			return sale === undefined ? undefined : { sale, view: view(sale) };
		},
	};
}
