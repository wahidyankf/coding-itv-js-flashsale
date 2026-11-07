import type { Result } from "@flash/typekit";
import type { Sale } from "../../domain/sale.js";
import type { ChangeSaleError, NewSale } from "../../domain/sale-window.js";

export type UpdateSaleError =
	| ChangeSaleError
	| "sale_not_found"
	| "sale_overlaps";
export type RemoveSaleError = "sale_not_found" | "sale_has_purchases";
export type CreateSaleStoreError = "sale_overlaps" | "product_not_found";

// What an operator does to the sales. `actor` is the id of the operator, who is recorded as the author of the change. Each write checks and writes in one step, so two operators cannot both pass a check
// that only one of them can satisfy.
export type SaleAdmin = {
	// Stores a new sale and returns its id and its product, unless its window overlaps a sale that is already there or
	// the product it names is not there. A sale with no product named gets the product of its name, made if needed.
	create: (
		sale: NewSale,
		actor: string,
	) => Promise<Result<{ id: string; productId: string }, CreateSaleStoreError>>;
	// Reads the sale, lets `decide` say what it becomes, and stores that, unless the new window overlaps another sale.
	update: (
		id: string,
		decide: (current: Sale) => Result<NewSale, ChangeSaleError>,
		actor: string,
	) => Promise<Result<Sale, UpdateSaleError>>;
	// Marks the sale and the holds on it as deleted, unless someone bought an item. Nothing is erased.
	remove: (id: string, actor: string) => Promise<Result<true, RemoveSaleError>>;
	// Every sale, the one that opens last first.
	list: () => Promise<Sale[]>;
};
