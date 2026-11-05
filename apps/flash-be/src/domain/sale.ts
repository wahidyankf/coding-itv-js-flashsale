export type Sale = {
	id: string;
	name: string;
	startsAt: Date;
	endsAt: Date;
	stock: number;
	sold: number;
	reservationTtlSeconds: number;
	admitPerSecond: number;
};

export type SaleStatus = "upcoming" | "active" | "sold_out" | "ended";

// The window decides first: after it closes the sale is ended, even if it sold out. Sold out only
// matters while the window is open.
export function saleStatus(sale: Sale, now: Date): SaleStatus {
	if (now < sale.startsAt) return "upcoming";
	if (now >= sale.endsAt) return "ended";
	return sale.sold >= sale.stock ? "sold_out" : "active";
}

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
		remaining: Math.max(sale.stock - sale.sold, 0),
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id can never match a row, so the lookup is skipped instead of failing in Postgres.
export function isSaleId(value: string): boolean {
	return UUID.test(value);
}
