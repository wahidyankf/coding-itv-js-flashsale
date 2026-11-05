import type { Option } from "@flash/typekit";
import type { Sale } from "../../domain/sale.js";

export type SaleRepository = {
	findById: (id: string) => Promise<Option<Sale>>;
	// The current sale is the one that opens last.
	findCurrent: () => Promise<Option<Sale>>;
};
