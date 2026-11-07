import { Err, Ok, type Result } from "@flash/typekit";
import { bearerToken, tokenMatches } from "../domain/admin-token.js";
import { isSaleId, type Sale } from "../domain/sale.js";
import {
	changeSaleFrom,
	newSaleFrom,
	type SaleDraft,
	type SalePatch,
} from "../domain/sale-window.js";
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

export type AuthorizeError = "not_found" | "invalid_admin_token";
export type CreateSaleError = "invalid_sale" | "sale_overlaps";

export type SaleAdminService = {
	// Without a token in the settings the admin routes are off and look as if they were not there.
	authorize: (
		authorization: string | undefined,
	) => Result<true, AuthorizeError>;
	create: (draft: SaleDraft) => Promise<Result<SaleView, CreateSaleError>>;
	// A sale that has not started can change in every field. Once it has started it keeps its start and can only get more
	// stock; a sale that is over cannot change (see `changeSaleFrom`).
	update: (
		id: string,
		patch: SalePatch,
	) => Promise<Result<SaleView, UpdateSaleError>>;
	remove: (id: string) => Promise<Result<true, RemoveSaleError>>;
	list: () => Promise<AdminSaleView[]>;
};

export function createSaleAdminService(
	token: string | undefined,
	store: SaleAdmin,
	clock: Clock,
): SaleAdminService {
	return {
		authorize: (authorization) => {
			if (token === undefined) return new Err("not_found");
			const given = bearerToken(authorization);
			return given !== undefined && tokenMatches(token, given)
				? new Ok(true as const)
				: new Err("invalid_admin_token");
		},
		create: async (draft) => {
			const input = newSaleFrom(draft);
			if (input.isErr()) return new Err(input.error);
			const stored = await store.create(input.value);
			if (stored.isErr()) return new Err(stored.error);
			const sale: Sale = { ...input.value, id: stored.value, sold: 0 };
			return new Ok(describeSale(sale, clock()));
		},
		update: async (id, patch) => {
			// A malformed id can never match a row, so the store is not asked.
			if (!isSaleId(id)) return new Err("sale_not_found");
			const updated = await store.update(id, (current) =>
				changeSaleFrom(current, patch, clock()),
			);
			if (updated.isErr()) return new Err(updated.error);
			return new Ok(describeSale(updated.value, clock()));
		},
		remove: async (id) => {
			if (!isSaleId(id)) return new Err("sale_not_found");
			return store.remove(id);
		},
		list: async () => {
			const now = clock();
			return (await store.list()).map((sale) => describeAdminSale(sale, now));
		},
	};
}
