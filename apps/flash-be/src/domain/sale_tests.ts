import { Some } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import {
	admissionsPerTick,
	queueBlock,
	remaining,
	reserveBlock,
	type Sale,
	saleStatus,
} from "./sale.js";

const sale: Sale = {
	id: "00000000-0000-4000-8000-000000000000",
	name: "Flash sale",
	startsAt: new Date("2026-01-01T10:00:00Z"),
	endsAt: new Date("2026-01-01T11:00:00Z"),
	stock: 3,
	sold: 1,
	reservationTtlSeconds: 120,
	admitPerSecond: 50,
};

describe("sale rules", () => {
	it("derives the status from the window first and the stock second", () => {
		expect(saleStatus(sale, new Date("2026-01-01T09:59:59Z"))).toBe("upcoming");
		expect(saleStatus(sale, new Date("2026-01-01T10:30:00Z"))).toBe("active");
		expect(
			saleStatus({ ...sale, sold: 3 }, new Date("2026-01-01T10:30:00Z")),
		).toBe("sold_out");
		expect(
			saleStatus({ ...sale, sold: 3 }, new Date("2026-01-01T11:00:00Z")),
		).toBe("ended");
	});

	it("never reports a negative remaining stock", () => {
		expect(remaining(sale)).toBe(2);
		expect(remaining({ ...sale, sold: 5 })).toBe(0);
	});

	it("blocks a reservation unless the sale is active", () => {
		expect(reserveBlock("upcoming")).toEqual(new Some("sale_not_started"));
		expect(reserveBlock("ended")).toEqual(new Some("sale_ended"));
		expect(reserveBlock("sold_out")).toEqual(new Some("sold_out"));
		expect(reserveBlock("active")).toBeUndefined();
	});

	it("lets a shopper queue before the sale opens but not after it is over", () => {
		expect(queueBlock("upcoming")).toBeUndefined();
		expect(queueBlock("active")).toBeUndefined();
		expect(queueBlock("ended")).toEqual(new Some("sale_ended"));
		expect(queueBlock("sold_out")).toEqual(new Some("sold_out"));
	});

	it("admits at least one shopper per tick", () => {
		expect(admissionsPerTick(sale, 1000)).toBe(50);
		expect(admissionsPerTick(sale, 200)).toBe(10);
		expect(admissionsPerTick({ ...sale, admitPerSecond: 1 }, 100)).toBe(1);
	});
});
