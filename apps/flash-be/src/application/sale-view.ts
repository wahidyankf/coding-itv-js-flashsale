import {
	remaining,
	type Sale,
	type SaleStatus,
	saleStatus,
} from "../domain/sale.js";

export type SaleView = {
	id: string;
	name: string;
	status: SaleStatus;
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

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
