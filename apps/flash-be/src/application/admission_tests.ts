// The admission timer's use case: it ticks the queue of the current sale, and does nothing when there is none.
import { describe, expect, it, vi } from "vitest";
import { admitCurrentSale } from "./admission.js";

describe("admitting the current sale", () => {
	it("ticks the queue of the sale shoppers are shown", async () => {
		const admitTick = vi.fn(async () => []);
		await admitCurrentSale(
			{ current: async () => ({ id: "sale-1" }) as never },
			{ admitTick },
		);
		expect(admitTick).toHaveBeenCalledWith("sale-1");
	});

	it("does nothing when there is no current sale", async () => {
		const admitTick = vi.fn(async () => []);
		await admitCurrentSale({ current: async () => undefined }, { admitTick });
		expect(admitTick).not.toHaveBeenCalled();
	});
});
