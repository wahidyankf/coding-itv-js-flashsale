// A sale as the rules see it: its window, its stock and what has been bought. Each function takes the sale and the
// moment `now`, and returns a value. Services decide on the Sale with these functions, never on the public view.
import { MS_PER_SECOND } from "@flash/flash-commons";

export type Sale = {
	id: string;
	// The product this sale sells. Many sales can sell one product, one after the other.
	productId: string;
	name: string;
	startsAt: Date;
	endsAt: Date;
	stock: number;
	// Items bought. Holds are not counted here; `hasRoom` counts them apart.
	sold: number;
	// How long one hold lasts, in seconds. The database column is `reservation_ttl_seconds`.
	holdSeconds: number;
	admitPerSecond: number;
};

// Where a sale stands at one moment: not open yet, open with stock left, open with no stock left, or over.
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

// The items not sold yet. Holds are not taken off, so a shopper may see items left while others hold them; the stock
// check counts the holds separately (see `hasRoom`).
export function remaining(sale: Sale): number {
	return Math.max(sale.stock - sale.sold, 0);
}

// Why a shopper cannot hold an item now.
export type ReserveBlock = "sale_not_started" | "sale_ended" | "sold_out";

// The sale answers in this order, so a shopper learns why without a valid ticket.
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

// Why a shopper cannot join the queue now.
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

// Why a shopper cannot pay for a hold now.
export type ConfirmBlock = "sale_ended";

// A hold can be paid for until the sale is over, even when it sold out: the holder already has the item.
export function confirmBlock(sale: Sale, now: Date): ConfirmBlock | undefined {
	switch (saleStatus(sale, now)) {
		case "ended":
			return "sale_ended";
		case "upcoming":
		case "active":
		case "sold_out":
			return undefined;
	}
}

// The fewest shoppers one admission tick lets in. A slow rate still moves the line, one shopper at a time.
const MIN_ADMITTED_PER_TICK = 1;

// How many shoppers one admission tick lets in, at the sale's rate.
export function admissionsPerTick(sale: Sale, tickMs: number): number {
	return Math.max(
		MIN_ADMITTED_PER_TICK,
		Math.round((sale.admitPerSecond * tickMs) / MS_PER_SECOND),
	);
}

// Whether one more hold fits: the items sold and the live holds of the other shoppers must stay under the stock. The
// Postgres fallback and the memory copies use this rule; the Redis script does the same count in Lua.
export function hasRoom(
	sold: number,
	liveHolds: number,
	stock: number,
): boolean {
	return sold + liveHolds < stock;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether the text can be the id of a sale, a reservation or a product. A malformed id can never match a row, so a
// lookup is skipped instead of failing in Postgres.
export function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}
