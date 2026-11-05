import type { Clock } from "../clock.js";
import { describeSale, isSaleId, type SaleView } from "./sale.js";
import type { SaleRepository } from "./sale-repository.js";

export type SaleService = {
	current: () => Promise<SaleView | undefined>;
	byId: (id: string) => Promise<SaleView | undefined>;
};

export function createSaleService(
	repository: SaleRepository,
	clock: Clock,
): SaleService {
	return {
		current: async () => {
			const sale = await repository.findCurrent();
			return sale ? describeSale(sale, clock()) : undefined;
		},
		byId: async (id) => {
			if (!isSaleId(id)) return undefined;
			const sale = await repository.findById(id);
			return sale ? describeSale(sale, clock()) : undefined;
		},
	};
}
