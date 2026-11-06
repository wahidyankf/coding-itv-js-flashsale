import { describe, expect, it } from "vitest";
import {
	DEFAULT_ADMIT_PER_SECOND,
	DEFAULT_HOLD_SECONDS,
	DEFAULT_SALE_NAME,
	newSaleFrom,
	overlaps,
	type SaleDraft,
} from "./sale-window.js";

const draft: SaleDraft = {
	stock: 5,
	startsAt: "2026-06-01T12:00:00.000Z",
	endsAt: "2026-06-01T13:00:00.000Z",
};

describe("newSaleFrom", () => {
	it("fills the name, the hold and the admission rate that were left out", () => {
		const sale = newSaleFrom(draft);
		expect(sale.isOk() && sale.value).toEqual({
			name: DEFAULT_SALE_NAME,
			stock: 5,
			startsAt: new Date("2026-06-01T12:00:00Z"),
			endsAt: new Date("2026-06-01T13:00:00Z"),
			reservationTtlSeconds: DEFAULT_HOLD_SECONDS,
			admitPerSecond: DEFAULT_ADMIT_PER_SECOND,
		});
	});

	it("keeps what the operator gave, with the name trimmed", () => {
		const sale = newSaleFrom({
			...draft,
			name: "  Spring drop ",
			holdSeconds: 30,
			admitPerSecond: 7,
		});
		expect(sale.isOk() && sale.value).toMatchObject({
			name: "Spring drop",
			reservationTtlSeconds: 30,
			admitPerSecond: 7,
		});
	});

	it.each([
		["a stock of zero", { stock: 0 }],
		["a stock with a fraction", { stock: 1.5 }],
		["a negative stock", { stock: -1 }],
		["an hold of zero", { holdSeconds: 0 }],
		["an admission rate of zero", { admitPerSecond: 0 }],
		["an empty name", { name: "   " }],
		["a name that is too long", { name: "x".repeat(121) }],
		["a start that is not a date", { startsAt: "tomorrow-ish" }],
		["an end that is not a date", { endsAt: "" }],
		["a window that ends when it starts", { endsAt: draft.startsAt }],
		["a window that ends before it starts", { endsAt: "2026-06-01T11:00:00Z" }],
	])("refuses %s", (_why, change) => {
		const sale = newSaleFrom({ ...draft, ...change });
		expect(sale.isErr() && sale.error).toBe("invalid_sale");
	});

	it("accepts the longest name", () => {
		expect(newSaleFrom({ ...draft, name: "x".repeat(120) }).isOk()).toBe(true);
	});
});

describe("overlaps", () => {
	const at = (from: number, to: number) => ({
		startsAt: new Date(from),
		endsAt: new Date(to),
	});

	it.each([
		["the same window", at(10, 20), at(10, 20)],
		["a window inside another", at(10, 20), at(12, 15)],
		["a window that starts inside another", at(10, 20), at(15, 30)],
		["a window that ends inside another", at(10, 20), at(0, 15)],
		["a window around another", at(10, 20), at(0, 30)],
	])("sees %s", (_why, a, b) => {
		expect(overlaps(a, b)).toBe(true);
		expect(overlaps(b, a)).toBe(true);
	});

	it.each([
		["a window that opens when the other closes", at(10, 20), at(20, 30)],
		["a window that closes when the other opens", at(10, 20), at(0, 10)],
		["a window far away", at(10, 20), at(40, 50)],
	])("does not see %s", (_why, a, b) => {
		expect(overlaps(a, b)).toBe(false);
		expect(overlaps(b, a)).toBe(false);
	});
});
