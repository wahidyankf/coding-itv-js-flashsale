// The seed use case with a fake store: it passes on what it is given, and returns the sale as the domain builds it, with
// nothing sold yet.
import { expect, it } from "vitest";
import { createSaleSeedService } from "./sale-seed-service.js";

it("returns the stored sale with its id and product, and nothing sold", async () => {
	const seen: unknown[] = [];
	const service = createSaleSeedService({
		seed: async (input, actor) => {
			seen.push({ input, actor });
			return { id: "sale-1", productId: "product-1" };
		},
	});
	const input = {
		name: "Seed sale",
		stock: 5,
		startsAt: new Date("2026-06-01T12:00:00Z"),
		endsAt: new Date("2026-06-01T13:00:00Z"),
		holdSeconds: 120,
		admitPerSecond: 50,
	};

	const sale = await service.seed(input, "actor-1");

	expect(sale).toMatchObject({
		id: "sale-1",
		productId: "product-1",
		name: "Seed sale",
		stock: 5,
		sold: 0,
		holdSeconds: 120,
	});
	expect(seen).toEqual([{ input, actor: "actor-1" }]);
});
