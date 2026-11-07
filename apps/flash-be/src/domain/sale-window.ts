import { Err, Ok, type Result } from "@flash/typekit";
import type { Sale } from "./sale.js";

// A sale to create. The window is absolute; the seed command works it out from minutes.
export type NewSale = {
	name: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
	reservationTtlSeconds: number;
	admitPerSecond: number;
};

export const DEFAULT_SALE_NAME = "Flash sale";
export const DEFAULT_HOLD_SECONDS = 120;
export const DEFAULT_ADMIT_PER_SECOND = 50;
export const DEFAULT_SALE_DURATION_MINUTES = 60;
const NAME_MAX_LENGTH = 120;

// What an operator sends, before any rule has looked at it.
export type SaleDraft = {
	name?: string | undefined;
	stock: number;
	startsAt: string;
	endsAt: string;
	holdSeconds?: number | undefined;
	admitPerSecond?: number | undefined;
};

const positiveInteger = (value: number): boolean =>
	Number.isSafeInteger(value) && value >= 1;

// Whether a sale can run: a stock to sell, a window that opens before it closes, and a hold and an admission rate
// that are whole and positive. Defaults fill what the operator left out.
export function newSaleFrom(draft: SaleDraft): Result<NewSale, "invalid_sale"> {
	const name = (draft.name ?? DEFAULT_SALE_NAME).trim();
	const startsAt = new Date(draft.startsAt);
	const endsAt = new Date(draft.endsAt);
	const reservationTtlSeconds = draft.holdSeconds ?? DEFAULT_HOLD_SECONDS;
	const admitPerSecond = draft.admitPerSecond ?? DEFAULT_ADMIT_PER_SECOND;

	const usable =
		name.length >= 1 &&
		name.length <= NAME_MAX_LENGTH &&
		positiveInteger(draft.stock) &&
		positiveInteger(reservationTtlSeconds) &&
		positiveInteger(admitPerSecond) &&
		!Number.isNaN(startsAt.getTime()) &&
		!Number.isNaN(endsAt.getTime()) &&
		endsAt > startsAt;
	return usable
		? new Ok({
				name,
				stock: draft.stock,
				startsAt,
				endsAt,
				reservationTtlSeconds,
				admitPerSecond,
			})
		: new Err("invalid_sale");
}

// What an operator sends to change a sale. A field that is left out stays as it is.
export type SalePatch = {
	[Field in keyof SaleDraft]?: SaleDraft[Field] | undefined;
};

export type ChangeSaleError = "invalid_sale" | "sale_locked";

// The sale after a change, or why it cannot change. The same rules as a new sale apply to the result. On top of that,
// a sale that is over is closed for good, and one that has started keeps its start and can only get more stock.
export function changeSaleFrom(
	sale: Sale,
	patch: SalePatch,
	now: Date,
): Result<NewSale, ChangeSaleError> {
	if (Object.values(patch).every((value) => value === undefined)) {
		return new Err("invalid_sale");
	}
	const changed = newSaleFrom({
		name: patch.name ?? sale.name,
		stock: patch.stock ?? sale.stock,
		startsAt: patch.startsAt ?? sale.startsAt.toISOString(),
		endsAt: patch.endsAt ?? sale.endsAt.toISOString(),
		holdSeconds: patch.holdSeconds ?? sale.reservationTtlSeconds,
		admitPerSecond: patch.admitPerSecond ?? sale.admitPerSecond,
	});
	if (changed.isErr()) return new Err(changed.error);
	if (now >= sale.endsAt) return new Err("sale_locked");
	const started = now >= sale.startsAt;
	const movesStart =
		changed.value.startsAt.getTime() !== sale.startsAt.getTime();
	if (started && (movesStart || changed.value.stock < sale.stock)) {
		return new Err("sale_locked");
	}
	return changed;
}

type Window = { startsAt: Date; endsAt: Date };

// Two windows overlap when each opens before the other closes. A sale that opens at the moment another one closes
// does not overlap it.
export function overlaps(a: Window, b: Window): boolean {
	return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}
