// A sale as the rules see it: its window, its stock and what has been bought. Domain layer: no I/O. Functions take the
// sale, and the moment `now` where time matters. Services decide on the Sale, never on the public view.
import { isUuid, MS_PER_SECOND } from "@flash/flash-commons";

// The sale the rules judge: its window, its stock and what has sold. Services decide on this type; the public view is
// built from it, never the other way round.
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

// A sale's state at one moment. Each switch over it lists every value, so a new state must be handled at each switch.
export type SaleStatus = "upcoming" | "active" | "sold_out" | "ended";

// The window decides first: after it closes the sale is ended, even if it sold out. Sold out only
// matters while the window is open.
export function saleStatus(sale: Sale, now: Date): SaleStatus {
	if (now < sale.startsAt) return "upcoming";
	if (now >= sale.endsAt) return "ended";
	return sale.sold >= sale.stock ? "sold_out" : "active";
}

// The sale shoppers are shown: the running one, else the next to open, else none. An ended sale is never current.
// The database repeats this in `findCurrent`; sale-rules_integration_tests checks both at the same moments.
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

// The reasons a hold is refused. Each one follows from the sale's status.
export type ReserveBlock = "sale_not_started" | "sale_ended" | "sold_out";

// It reads only the status, so no ticket is needed to give the reason.
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

// The reasons a shopper cannot join the queue.
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

// The reason a hold cannot be paid for. Only an ended sale refuses.
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

// How many shoppers one tick lets in, at the sale's rate. Never less than MIN_ADMITTED_PER_TICK.
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

// The id check of the sale rules is the one shared in flash-commons: whether the text can be the id of a sale, a reservation
// or a product. It is re-exported here, so the rules keep one import for their callers.
export { isUuid };
