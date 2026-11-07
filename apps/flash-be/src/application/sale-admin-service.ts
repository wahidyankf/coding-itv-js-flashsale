// The operator's writes to sales: create, change, remove and list. The rules that decide a write are in the domain
// (sale-window); this service asks the store, and shapes the reply. Seeding is a different use case (sale-seed-service).
import { Err, Ok, type Result } from "@flash/typekit";
import { isSaleId } from "../domain/sale.js";
import {
	changeSaleFrom,
	newSale,
	newSaleFrom,
	type SaleDraft,
	type SalePatch,
} from "../domain/sale-window.js";
import type { UserId } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type {
	RemoveSaleError,
	SaleAdmin,
	UpdateSaleError,
} from "./ports/sale-admin.js";
import {
	type AdminSaleView,
	describeAdminSale,
	describeSale,
	type SaleView,
} from "./sale-view.js";

// Why an operator's sale cannot be created: the input is not usable, the window overlaps a sale, or the product named
// does not exist.
export type CreateSaleError =
	| "invalid_sale"
	| "sale_overlaps"
	| "product_not_found";

export type SaleAdminService = {
	// Creates a sale. `actor` is the operator who made it, recorded as the author.
	create: (
		draft: SaleDraft,
		actor: UserId,
	) => Promise<Result<SaleView, CreateSaleError>>;
	// A sale that has not started can change in every field. Once it has started it keeps its start and can only get more
	// stock; a sale that is over cannot change (see `changeSaleFrom`).
	update: (
		id: string,
		patch: SalePatch,
		actor: UserId,
	) => Promise<Result<SaleView, UpdateSaleError>>;
	// Removes a sale that nobody bought from.
	remove: (id: string, actor: UserId) => Promise<Result<true, RemoveSaleError>>;
	// Every sale, for the operator's list.
	list: () => Promise<AdminSaleView[]>;
};

export function createSaleAdminService(
	store: SaleAdmin,
	clock: Clock,
): SaleAdminService {
	return {
		create: async (draft, actor) => {
			const input = newSaleFrom(draft);
			if (input.isErr()) return new Err(input.error);
			const stored = await store.create(input.value, actor);
			if (stored.isErr()) return new Err(stored.error);
			const sale = newSale({ ...input.value, ...stored.value });
			return new Ok(describeSale(sale, clock()));
		},
		update: async (id, patch, actor) => {
			// A malformed id can never match a row, so the store is not asked.
			if (!isSaleId(id)) return new Err("sale_not_found");
			const updated = await store.update(
				id,
				(current) => changeSaleFrom(current, patch, clock()),
				actor,
			);
			if (updated.isErr()) return new Err(updated.error);
			return new Ok(describeSale(updated.value, clock()));
		},
		remove: async (id, actor) => {
			if (!isSaleId(id)) return new Err("sale_not_found");
			return store.remove(id, actor);
		},
		list: async () => {
			const now = clock();
			return (await store.list()).map((sale) => describeAdminSale(sale, now));
		},
	};
}
