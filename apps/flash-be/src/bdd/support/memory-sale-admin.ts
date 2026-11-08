// The sales store in memory for the unit layer. It refuses overlapping sales and unknown products. A removed sale is
// kept in a map with who removed it, as the soft delete keeps it in Postgres.
import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import type { SaleAdmin } from "../../application/ports/sale-admin.js";
import type { Sale } from "../../domain/sale.js";
import { newSale, overlaps } from "../../domain/sale-window.js";

// A sale store in memory, for scenarios that need no database. The scenario reads the same list this store changes.
// `products` maps a product id to its name: the products that exist, which a sale can name.
export function memorySaleAdmin(
	sales: Sale[],
	products: Map<string, string> = new Map(),
	// The sales that were removed, with the actor who removed each. The memory store keeps no rows, so this stands for
	// rows marked deleted.
	removed: Map<string, string> = new Map(),
): SaleAdmin {
	// The product a new sale sells: the one it names, else the one of its name, made if it is not there.
	const productFor = (name: string, named: string | undefined) => {
		if (named !== undefined) return products.has(named) ? named : undefined;
		for (const [id, productName] of products) {
			if (productName === name) return id;
		}
		const id = randomUUID();
		products.set(id, name);
		return id;
	};
	return {
		create: async (input) => {
			if (sales.some((sale) => overlaps(sale, input))) {
				return new Err("sale_overlaps" as const);
			}
			const productId = productFor(input.name, input.productId);
			if (productId === undefined) return new Err("product_not_found" as const);
			const sale = newSale({ ...input, id: randomUUID(), productId });
			sales.push(sale);
			return new Ok({ id: sale.id, productId });
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
			const changed: Sale = {
				...next.value,
				id,
				productId: current.productId,
				sold: current.sold,
			};
			sales[index] = changed;
			return new Ok(changed);
		},
		// The memory store has no purchase rows; a sale with items sold stands for one that has purchases.
		remove: async (id, actor) => {
			const index = sales.findIndex((sale) => sale.id === id);
			const found = sales[index];
			if (found === undefined) return new Err("sale_not_found" as const);
			if (found.sold > 0) return new Err("sale_has_purchases" as const);
			sales.splice(index, 1);
			removed.set(id, actor);
			return new Ok(true as const);
		},
		list: async () =>
			[...sales].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
	};
}
