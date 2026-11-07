// The sale as the HTTP API shows it (inbound HTTP adapter): the public view that shoppers read, and the operator's view with
// the numbers only an operator needs. Dates are ISO text, as JSON carries them. The wire names and their order are part of
// the HTTP contract; the routes and the event stream send these objects as they are. The status comes from the service.
import { remaining, type Sale, type SaleStatus } from "../../../domain/sale.js";

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

// The public view of a sale, with the status it has at the moment of the read.
export function describeSale(sale: Sale, status: SaleStatus): SaleView {
	return {
		id: sale.id,
		productId: sale.productId,
		name: sale.name,
		status,
		startsAt: sale.startsAt.toISOString(),
		endsAt: sale.endsAt.toISOString(),
		stock: sale.stock,
		remaining: remaining(sale),
	};
}

// The operator's view of a sale: the public view, then the numbers only an operator needs.
export function describeAdminSale(
	sale: Sale,
	status: SaleStatus,
): AdminSaleView {
	return {
		...describeSale(sale, status),
		sold: sale.sold,
		holdSeconds: sale.holdSeconds,
		admitPerSecond: sale.admitPerSecond,
	};
}
