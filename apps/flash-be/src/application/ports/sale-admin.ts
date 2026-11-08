// Kind: a plain port (no suffix). Application layer. It writes Postgres rows, but is named as a port, since
// SaleRepository already names the reads. Each write checks and writes in one step, so two operators cannot both win a
// check that only one can pass.
import type { Result } from "@flash/typekit";
import type { Sale } from "../../domain/sale.js";
import type { ChangeSaleError, NewSale } from "../../domain/sale-window.js";
import type { UserId } from "../../domain/user.js";

// Why a change is refused: the change is invalid or locked, the sale is missing, or its window overlaps another sale.
export type UpdateSaleError =
	| ChangeSaleError
	| "sale_not_found"
	| "sale_overlaps";
// Why a removal is refused: no such sale, or a sale with purchases, whose record must stay.
export type RemoveSaleError = "sale_not_found" | "sale_has_purchases";
// Why the store refuses a new sale: its window overlaps a sale already there, or the product it names is not there.
export type CreateSaleStoreError = "sale_overlaps" | "product_not_found";

// The write side of the sales, as the operator's use case calls it. The store refuses an overlap or a missing product
// itself, so the check and the write cannot be separated.
export type SaleAdmin = {
	// Stores a new sale and returns its id and its product, unless its window overlaps a sale that is already there or
	// the product it names is not there. A sale with no product named gets the product of its name, made if needed.
	create: (
		sale: NewSale,
		actor: UserId,
	) => Promise<Result<{ id: string; productId: string }, CreateSaleStoreError>>;
	// Reads the sale, lets `decide` say what it becomes, and stores that, unless the new window overlaps another sale.
	update: (
		id: string,
		decide: (current: Sale) => Result<NewSale, ChangeSaleError>,
		actor: UserId,
	) => Promise<Result<Sale, UpdateSaleError>>;
	// Marks the sale and the holds on it as deleted, unless someone bought an item. Nothing is erased.
	remove: (id: string, actor: UserId) => Promise<Result<true, RemoveSaleError>>;
	// Every sale, latest start first.
	list: () => Promise<Sale[]>;
};
