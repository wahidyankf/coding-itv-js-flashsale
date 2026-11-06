import type { Result } from "@flash/typekit";
import type { NewSale } from "../../domain/sale-window.js";

// Stores a new sale and returns its id, unless its window overlaps a sale that is already there. The check and the
// insert are one step, so two creates of the same window cannot both succeed.
export type SaleAdmin = {
	create: (sale: NewSale) => Promise<Result<string, "sale_overlaps">>;
};
