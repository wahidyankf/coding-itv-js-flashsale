import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import type { SaleAdmin } from "../../application/ports/sale-admin.js";
import type { Sale } from "../../domain/sale.js";
import { overlaps } from "../../domain/sale-window.js";

// A sale store in memory, for scenarios that need no database. It adds to the list a scenario also reads from.
export function memorySaleAdmin(sales: Sale[]): SaleAdmin {
	return {
		create: async (input) => {
			if (sales.some((sale) => overlaps(sale, input))) {
				return new Err("sale_overlaps" as const);
			}
			const sale: Sale = { ...input, id: randomUUID(), sold: 0 };
			sales.push(sale);
			return new Ok(sale.id);
		},
	};
}
