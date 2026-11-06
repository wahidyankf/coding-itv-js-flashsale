import { Err, Ok, type Result } from "@flash/typekit";
import { bearerToken, tokenMatches } from "../domain/admin-token.js";
import type { Sale } from "../domain/sale.js";
import { newSaleFrom, type SaleDraft } from "../domain/sale-window.js";
import type { Clock } from "./ports/clock.js";
import type { SaleAdmin } from "./ports/sale-admin.js";
import { describeSale, type SaleView } from "./sale-view.js";

export type AuthorizeError = "not_found" | "invalid_admin_token";
export type CreateSaleError = "invalid_sale" | "sale_overlaps";

export type SaleAdminService = {
	// Without a token in the settings the admin routes are off and look as if they were not there.
	authorize: (
		authorization: string | undefined,
	) => Result<true, AuthorizeError>;
	create: (draft: SaleDraft) => Promise<Result<SaleView, CreateSaleError>>;
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
			return given && tokenMatches(token, given.value)
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
	};
}
