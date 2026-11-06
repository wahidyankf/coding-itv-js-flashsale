import type { SaleView } from "@flash/contract";
import { remaining, type Sale, saleStatus } from "../domain/sale.js";

export type { SaleView };

export function describeSale(sale: Sale, now: Date): SaleView {
	return {
		id: sale.id,
		name: sale.name,
		status: saleStatus(sale, now),
		startsAt: sale.startsAt.toISOString(),
		endsAt: sale.endsAt.toISOString(),
		stock: sale.stock,
		remaining: remaining(sale),
	};
}
