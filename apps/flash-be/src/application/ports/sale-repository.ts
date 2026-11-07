import type { Sale } from "../../domain/sale.js";

export type SaleRepository = {
	findById: (id: string) => Promise<Sale | undefined>;
	// The sale shoppers are shown at `now`: the one running, else the one that opens next, else none (see `pickCurrent`).
	findCurrent: (now: Date) => Promise<Sale | undefined>;
};
