import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import type { SaleAdmin } from "../../application/ports/sale-admin.js";
import type { Sale } from "../../domain/sale.js";
import { overlaps } from "../../domain/sale-window.js";

// A sale store in memory, for scenarios that need no database. It changes the list a scenario also reads from.
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
		update: async (id, decide) => {
			const index = sales.findIndex((sale) => sale.id === id);
			const current = sales[index];
			if (current === undefined) return new Err("sale_not_found" as const);
			const next = decide(current);
			if (next.isErr()) return new Err(next.error);
			if (sales.some((sale) => sale.id !== id && overlaps(sale, next.value))) {
				return new Err("sale_overlaps" as const);
			}
			const changed: Sale = { ...next.value, id, sold: current.sold };
			sales[index] = changed;
			return new Ok(changed);
		},
		// The memory store has no purchase rows; a sale with items sold stands for one that has purchases.
		remove: async (id) => {
			const index = sales.findIndex((sale) => sale.id === id);
			const found = sales[index];
			if (found === undefined) return new Err("sale_not_found" as const);
			if (found.sold > 0) return new Err("sale_has_purchases" as const);
			sales.splice(index, 1);
			return new Ok(true as const);
		},
		list: async () =>
			[...sales].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
	};
}
