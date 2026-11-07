// The sale rules: the status of a sale, the blocks on reserving, queueing and confirming, the room left for holds, and
// the current sale.
import { describe, expect, it } from "vitest";
import {
	admissionsPerTick,
	confirmBlock,
	hasRoom,
	pickCurrent,
	queueBlock,
	remaining,
	reserveBlock,
	type Sale,
	saleStatus,
} from "./sale.js";

const sale: Sale = {
	id: "00000000-0000-4000-8000-000000000000",
	productId: "00000000-0000-4000-8000-0000000000aa",
	name: "Flash sale",
	startsAt: new Date("2026-01-01T10:00:00Z"),
	endsAt: new Date("2026-01-01T11:00:00Z"),
	stock: 3,
	sold: 1,
	holdSeconds: 120,
	admitPerSecond: 50,
};

const OPEN = new Date("2026-01-01T10:30:00Z");

describe("sale rules", () => {
	it("derives the status from the window first and the stock second", () => {
		expect(saleStatus(sale, new Date("2026-01-01T09:59:59Z"))).toBe("upcoming");
		expect(saleStatus(sale, OPEN)).toBe("active");
		expect(saleStatus({ ...sale, sold: 3 }, OPEN)).toBe("sold_out");
		expect(
			saleStatus({ ...sale, sold: 3 }, new Date("2026-01-01T11:00:00Z")),
		).toBe("ended");
	});

	it("never reports a negative remaining stock", () => {
		expect(remaining(sale)).toBe(2);
		expect(remaining({ ...sale, sold: 5 })).toBe(0);
	});

	it("blocks a reservation unless the sale is active", () => {
		expect(reserveBlock("upcoming")).toBe("sale_not_started");
		expect(reserveBlock("ended")).toBe("sale_ended");
		expect(reserveBlock("sold_out")).toBe("sold_out");
		expect(reserveBlock("active")).toBeUndefined();
	});

	it("lets a shopper queue before the sale opens but not after it is over", () => {
		expect(queueBlock("upcoming")).toBeUndefined();
		expect(queueBlock("active")).toBeUndefined();
		expect(queueBlock("ended")).toBe("sale_ended");
		expect(queueBlock("sold_out")).toBe("sold_out");
	});

	it("admits at least one shopper per tick", () => {
		expect(admissionsPerTick(sale, 1000)).toBe(50);
		expect(admissionsPerTick(sale, 200)).toBe(10);
		expect(admissionsPerTick({ ...sale, admitPerSecond: 1 }, 100)).toBe(1);
	});

	it("confirms a purchase of a hold until the sale is over, even when sold out", () => {
		expect(
			confirmBlock(sale, new Date("2026-01-01T09:59:00Z")),
		).toBeUndefined();
		expect(confirmBlock(sale, OPEN)).toBeUndefined();
		expect(confirmBlock({ ...sale, sold: 3 }, OPEN)).toBeUndefined();
		expect(confirmBlock(sale, new Date("2026-01-01T11:00:00Z"))).toBe(
			"sale_ended",
		);
	});

	it("has room for one more hold while sold and live holds stay under the stock", () => {
		expect(hasRoom(1, 1, 3)).toBe(true);
		expect(hasRoom(1, 2, 3)).toBe(false);
		expect(hasRoom(3, 0, 3)).toBe(false);
		expect(hasRoom(0, 0, 1)).toBe(true);
	});
});

describe("pickCurrent", () => {
	it("picks the sale whose window holds now, else the next to open", () => {
		const later = {
			...sale,
			id: "later",
			startsAt: new Date("2026-01-01T12:00:00Z"),
			endsAt: new Date("2026-01-01T13:00:00Z"),
		};
		expect(pickCurrent([later, sale], OPEN)?.id).toBe(sale.id);
		expect(
			pickCurrent([later, sale], new Date("2026-01-01T09:00:00Z"))?.id,
		).toBe(sale.id);
		expect(pickCurrent([later], OPEN)?.id).toBe("later");
		expect(
			pickCurrent([sale], new Date("2026-01-01T11:00:00Z")),
		).toBeUndefined();
	});
});
