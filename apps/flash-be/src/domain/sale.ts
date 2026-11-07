import { MS_PER_SECOND } from "./time.js";

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

// The sale shoppers are shown: the one whose window holds `now`, else the one that opens next, else none. A sale that
// has ended is not current any more (it can still be read by its id). Windows never overlap, so at most one is running.
export function pickCurrent(
	sales: readonly Sale[],
	now: Date,
): Sale | undefined {
	const notOver = sales.filter((sale) => now < sale.endsAt);
	return (
		notOver.find((sale) => sale.startsAt <= now) ??
		[...notOver].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]
	);
}

// The items nobody holds or bought yet, counting only sales.
export function remaining(sale: Sale): number {
	return Math.max(sale.stock - sale.sold, 0);
}

export type ReserveBlock = "sale_not_started" | "sale_ended" | "sold_out";

// Why a shopper cannot hold an item now. The sale answers in this order, so a shopper learns it without a ticket.
export function reserveBlock(status: SaleStatus): ReserveBlock | undefined {
	switch (status) {
		case "upcoming":
			return "sale_not_started";
		case "ended":
			return "sale_ended";
		case "sold_out":
			return "sold_out";
		case "active":
			return undefined;
	}
}

export type QueueBlock = "sale_ended" | "sold_out";

// A shopper may queue before the sale opens, but not once it is over or sold out.
export function queueBlock(status: SaleStatus): QueueBlock | undefined {
	switch (status) {
		case "ended":
			return "sale_ended";
		case "sold_out":
			return "sold_out";
		case "upcoming":
		case "active":
			return undefined;
	}
}

// How many shoppers one admission tick lets in. At least one, so a slow rate never stalls the line.
export function admissionsPerTick(sale: Sale, tickMs: number): number {
	return Math.max(
		1,
		Math.round((sale.admitPerSecond * tickMs) / MS_PER_SECOND),
	);
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id can never match a row, so the lookup is skipped instead of failing in Postgres.
export function isSaleId(value: string): boolean {
	return UUID_PATTERN.test(value);
}
