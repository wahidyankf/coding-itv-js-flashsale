import { Err, Ok, type Result } from "@flash/typekit";

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

type Window = { startsAt: Date; endsAt: Date };

// Two windows overlap when each opens before the other closes. A sale that opens at the moment another one closes
// does not overlap it.
export function overlaps(a: Window, b: Window): boolean {
	return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}
