// The hold request: the time a hold ends, counted from the hold time the sale sets.
import { describe, expect, it } from "vitest";
import { holdRequest } from "./reservation.js";
import type { Sale } from "./sale.js";

const sale: Sale = {
	id: "00000000-0000-4000-8000-000000000000",
	productId: "00000000-0000-4000-8000-0000000000aa",
	name: "Flash sale",
	startsAt: new Date("2026-01-01T10:00:00Z"),
	endsAt: new Date("2026-01-01T11:00:00Z"),
	stock: 3,
	sold: 0,
	holdSeconds: 90,
	admitPerSecond: 50,
};

describe("reservation rules", () => {
	it("holds an item for the time the sale sets", () => {
		const now = new Date("2026-01-01T10:00:00Z");
		const request = holdRequest(sale, "ana", "r-1", now);
		expect(request).toEqual({
			saleId: sale.id,
			user: "ana",
			reservationId: "r-1",
			now,
			expiresAt: new Date("2026-01-01T10:01:30Z"),
			stock: 3,
		});
	});
});
