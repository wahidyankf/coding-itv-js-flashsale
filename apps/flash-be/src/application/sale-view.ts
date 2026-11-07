// The sale as the API shows it: the public view that shoppers read, and the operator's view with the numbers only an
// operator needs. Dates are ISO text, as JSON carries them. The wire names here are part of the HTTP contract.
import {
	remaining,
	type Sale,
	type SaleStatus,
	saleStatus,
} from "../domain/sale.js";

// A sale as shoppers see it.
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

// The operator's view of a sale at `now`.
export function describeAdminSale(sale: Sale, now: Date): AdminSaleView {
	return {
		...describeSale(sale, now),
		sold: sale.sold,
		holdSeconds: sale.holdSeconds,
		admitPerSecond: sale.admitPerSecond,
	};
}

// The public view of a sale at `now`: its status is worked out from the window and the stock at that moment.
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
