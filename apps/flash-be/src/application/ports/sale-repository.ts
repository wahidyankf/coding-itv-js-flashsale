import type { Sale } from "../../domain/sale.js";

export type SaleRepository = {
	findById: (id: string) => Promise<Sale | undefined>;
	// The current sale is the one that opens last.
	findCurrent: () => Promise<Sale | undefined>;
};
