import {
	remaining,
	type Sale,
	type SaleStatus,
	saleStatus,
} from "../domain/sale.js";

// A sale as the API shows it. Dates are ISO strings, as JSON carries them.
export type SaleView = {
	id: string;
	productId: string;
	name: string;
	status: SaleStatus;
	startsAt: string;
	endsAt: string;
	stock: number;
	remaining: number;
};

// What the operator sees of a sale: the public view and the numbers only an operator needs.
export type AdminSaleView = SaleView & {
	sold: number;
	holdSeconds: number;
	admitPerSecond: number;
};

export function describeAdminSale(sale: Sale, now: Date): AdminSaleView {
	return {
		...describeSale(sale, now),
		sold: sale.sold,
		holdSeconds: sale.reservationTtlSeconds,
		admitPerSecond: sale.admitPerSecond,
	};
}

export function describeSale(sale: Sale, now: Date): SaleView {
	return {
		id: sale.id,
		productId: sale.productId,
		name: sale.name,
		status: saleStatus(sale, now),
		startsAt: sale.startsAt.toISOString(),
		endsAt: sale.endsAt.toISOString(),
		stock: sale.stock,
		remaining: remaining(sale),
	};
}
