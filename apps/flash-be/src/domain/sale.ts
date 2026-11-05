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

// The items nobody holds or bought yet, counting only sales.
export function remaining(sale: Sale): number {
	return Math.max(sale.stock - sale.sold, 0);
}

export type ReserveBlock = "sale_not_started" | "sale_ended" | "sold_out";

// Why a shopper cannot hold an item now. The sale answers in this order, so a shopper learns it without a ticket.
export function reserveBlock(status: SaleStatus): ReserveBlock | undefined {
	if (status === "upcoming") return "sale_not_started";
	if (status === "ended") return "sale_ended";
	if (status === "sold_out") return "sold_out";
	return undefined;
}

export type QueueBlock = "sale_ended" | "sold_out";

// A shopper may queue before the sale opens, but not once it is over or sold out.
export function queueBlock(status: SaleStatus): QueueBlock | undefined {
	if (status === "ended") return "sale_ended";
	return status === "sold_out" ? status : undefined;
}

// How many shoppers one admission tick lets in. At least one, so a slow rate never stalls the line.
export function admissionsPerTick(sale: Sale, tickMs: number): number {
	return Math.max(1, Math.round((sale.admitPerSecond * tickMs) / 1000));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id can never match a row, so the lookup is skipped instead of failing in Postgres.
export function isSaleId(value: string): boolean {
	return UUID.test(value);
}
