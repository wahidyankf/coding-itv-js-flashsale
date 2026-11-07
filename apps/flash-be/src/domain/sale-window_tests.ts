// The sale windows: a new sale from a draft or a change, overlaps between sales, and a new sale with its id and no sold items.
import { describe, expect, it } from "vitest";
import type { Sale } from "./sale.js";
import {
	changeSaleFrom,
	DEFAULT_ADMIT_PER_SECOND,
	DEFAULT_HOLD_SECONDS,
	DEFAULT_SALE_NAME,
	newSale,
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
			holdSeconds: DEFAULT_HOLD_SECONDS,
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
			holdSeconds: 30,
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

describe("changeSaleFrom", () => {
	const sale: Sale = {
		id: "00000000-0000-4000-8000-000000000000",
		productId: "00000000-0000-4000-8000-0000000000aa",
		name: "Flash sale",
		startsAt: new Date("2026-06-01T12:00:00Z"),
		endsAt: new Date("2026-06-01T13:00:00Z"),
		stock: 5,
		sold: 2,
		holdSeconds: 120,
		admitPerSecond: 50,
	};
	const before = new Date("2026-06-01T11:00:00Z");
	const during = new Date("2026-06-01T12:30:00Z");
	const after = new Date("2026-06-01T13:00:00Z");

	it("changes any field of a sale that has not started", () => {
		const changed = changeSaleFrom(
			sale,
			{
				name: "Spring",
				stock: 3,
				startsAt: "2026-06-01T14:00:00.000Z",
				endsAt: "2026-06-01T15:00:00.000Z",
				holdSeconds: 30,
				admitPerSecond: 7,
			},
			before,
		);
		expect(changed.isOk() && changed.value).toEqual({
			name: "Spring",
			stock: 3,
			startsAt: new Date("2026-06-01T14:00:00Z"),
			endsAt: new Date("2026-06-01T15:00:00Z"),
			holdSeconds: 30,
			admitPerSecond: 7,
		});
	});

	it("keeps what the patch leaves out", () => {
		const changed = changeSaleFrom(sale, { stock: 9 }, before);
		expect(changed.isOk() && changed.value).toMatchObject({
			name: "Flash sale",
			stock: 9,
			startsAt: sale.startsAt,
			endsAt: sale.endsAt,
			holdSeconds: 120,
			admitPerSecond: 50,
		});
	});

	it("lets a running sale get more stock, a later end, a new name, hold time and rate", () => {
		const changed = changeSaleFrom(
			sale,
			{
				stock: 8,
				endsAt: "2026-06-01T14:00:00.000Z",
				name: "Extended",
				holdSeconds: 60,
				admitPerSecond: 10,
			},
			during,
		);
		expect(changed.isOk() && changed.value).toMatchObject({
			stock: 8,
			endsAt: new Date("2026-06-01T14:00:00Z"),
			name: "Extended",
			holdSeconds: 60,
			admitPerSecond: 10,
		});
	});

	it("accepts the same start and the same stock on a running sale", () => {
		const changed = changeSaleFrom(
			sale,
			{ startsAt: sale.startsAt.toISOString(), stock: sale.stock },
			during,
		);
		expect(changed.isOk()).toBe(true);
	});

	it.each([
		["a later start", { startsAt: "2026-06-01T12:45:00.000Z" }],
		["an earlier start", { startsAt: "2026-06-01T12:10:00.000Z" }],
		["less stock", { stock: 4 }],
	])("locks a running sale against %s", (_why, patch) => {
		const changed = changeSaleFrom(sale, patch, during);
		expect(changed.isErr() && changed.error).toBe("sale_locked");
	});

	it("locks a sale that is over, even for a change that would be valid", () => {
		const changed = changeSaleFrom(sale, { stock: 9 }, after);
		expect(changed.isErr() && changed.error).toBe("sale_locked");
	});

	it.each([
		["nothing to change", {}],
		["only fields that are left out", { stock: undefined }],
		["a stock of zero", { stock: 0 }],
		["an end before the start", { endsAt: "2026-06-01T11:00:00.000Z" }],
		["an empty name", { name: " " }],
	])("refuses %s", (_why, patch) => {
		const changed = changeSaleFrom(sale, patch, before);
		expect(changed.isErr() && changed.error).toBe("invalid_sale");
	});

	it("reports a value that is not valid before it reports a lock", () => {
		const changed = changeSaleFrom(sale, { stock: 0 }, after);
		expect(changed.isErr() && changed.error).toBe("invalid_sale");
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

describe("newSale", () => {
	it("makes a stored sale with nothing sold yet, from the checked sale and its ids", () => {
		const checked = newSaleFrom(draft);
		if (checked.isErr()) throw new Error("the draft should be usable");
		expect(
			newSale({
				...checked.value,
				id: "00000000-0000-4000-8000-0000000000c1",
				productId: "00000000-0000-4000-8000-0000000000c2",
			}),
		).toEqual({
			id: "00000000-0000-4000-8000-0000000000c1",
			productId: "00000000-0000-4000-8000-0000000000c2",
			name: DEFAULT_SALE_NAME,
			stock: 5,
			startsAt: new Date("2026-06-01T12:00:00Z"),
			endsAt: new Date("2026-06-01T13:00:00Z"),
			sold: 0,
			holdSeconds: DEFAULT_HOLD_SECONDS,
			admitPerSecond: DEFAULT_ADMIT_PER_SECOND,
		});
	});
});
