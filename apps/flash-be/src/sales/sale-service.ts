import type { Clock } from "../clock.js";
import { describeSale, isSaleId, type Sale, type SaleView } from "./sale.js";
import type { SaleRepository } from "./sale-repository.js";

export type SaleService = {
	current: () => Promise<SaleView | undefined>;
	byId: (id: string) => Promise<SaleView | undefined>;
	// The sale with its rules (hold time, admission rate) next to the public view. For the server's own use.
	details: (id: string) => Promise<{ sale: Sale; view: SaleView } | undefined>;
};

export function createSaleService(
	repository: SaleRepository,
	clock: Clock,
): SaleService {
	const details: SaleService["details"] = async (id) => {
		if (!isSaleId(id)) return undefined;
		const sale = await repository.findById(id);
		return sale ? { sale, view: describeSale(sale, clock()) } : undefined;
	};

	return {
		current: async () => {
			const sale = await repository.findCurrent();
			return sale ? describeSale(sale, clock()) : undefined;
		},
		byId: async (id) => (await details(id))?.view,
		details,
	};
}
