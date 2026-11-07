import { describe, expect, it } from "vitest";
import {
	admissionsPerTick,
	pickCurrent,
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
});

describe("pickCurrent", () => {
	const at = (name: string, from: string, to: string): Sale => ({
		...sale,
		id: name,
		name,
		startsAt: new Date(from),
		endsAt: new Date(to),
	});
	const ended = at("ended", "2026-01-01T08:00:00Z", "2026-01-01T09:00:00Z");
	const running = at("running", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z");
	const next = at("next", "2026-01-01T12:00:00Z", "2026-01-01T13:00:00Z");
	const later = at("later", "2026-01-01T14:00:00Z", "2026-01-01T15:00:00Z");
	const now = new Date("2026-01-01T10:30:00Z");

	it("prefers the running sale over one that opens later", () => {
		expect(pickCurrent([later, next, running, ended], now)?.name).toBe(
			"running",
		);
	});

	it("takes the sale that opens next when none is running", () => {
		expect(
			pickCurrent([later, next, ended], new Date("2026-01-01T11:30:00Z"))?.name,
		).toBe("next");
	});

	it("counts a sale that opens at this moment as running, and one that closes at this moment as over", () => {
		expect(pickCurrent([running], running.startsAt)?.name).toBe("running");
		expect(pickCurrent([running], running.endsAt)).toBeUndefined();
	});

	it("finds nothing when every sale is over or there is none", () => {
		expect(pickCurrent([ended], now)).toBeUndefined();
		expect(pickCurrent([], now)).toBeUndefined();
	});
});
