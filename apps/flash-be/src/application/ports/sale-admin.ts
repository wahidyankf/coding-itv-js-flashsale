import type { Result } from "@flash/typekit";
import type { Sale } from "../../domain/sale.js";
import type { ChangeSaleError, NewSale } from "../../domain/sale-window.js";

export type UpdateSaleError =
	| ChangeSaleError
	| "sale_not_found"
	| "sale_overlaps";
export type RemoveSaleError = "sale_not_found" | "sale_has_purchases";

// What an operator does to the sales. Each write checks and writes in one step, so two operators cannot both pass a check
// that only one of them can satisfy.
export type SaleAdmin = {
	// Stores a new sale and returns its id, unless its window overlaps a sale that is already there.
	create: (sale: NewSale) => Promise<Result<string, "sale_overlaps">>;
	// Reads the sale, lets `decide` say what it becomes, and stores that, unless the new window overlaps another sale.
	update: (
		id: string,
		decide: (current: Sale) => Result<NewSale, ChangeSaleError>,
	) => Promise<Result<Sale, UpdateSaleError>>;
	// Deletes the sale and the holds on it, unless someone bought an item.
	remove: (id: string) => Promise<Result<true, RemoveSaleError>>;
	// Every sale, the one that opens last first.
	list: () => Promise<Sale[]>;
};
