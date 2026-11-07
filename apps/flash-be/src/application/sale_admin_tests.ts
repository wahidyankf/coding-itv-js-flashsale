// The operator's sale use case: creating, changing, removing and listing sales, with the checks on each step.

import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { fakeSale } from "../bdd/support/fake-sales.js";
import { memorySaleAdmin } from "../bdd/support/memory-sale-admin.js";
import type { Sale } from "../domain/sale.js";
import { userIdOf } from "../domain/user.js";
import type { SaleAdmin } from "./ports/sale-admin.js";
import { createSaleAdminService } from "./sale-admin-service.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const PRODUCT_ID = "00000000-0000-4000-8000-0000000000aa";
const ACTOR = "00000000-0000-4000-8000-0000000000bb";
const draft = {
	stock: 5,
	startsAt: "2026-06-01T13:00:00.000Z",
	endsAt: "2026-06-01T14:00:00.000Z",
};

// A store that only creates; the other calls are not what the test is about.
const creating = (create: SaleAdmin["create"]): SaleAdmin => ({
	create,
	update: async () => new Err("sale_not_found"),
	remove: async () => new Err("sale_not_found"),
	list: async () => [],
});

function serviceWith(store?: SaleAdmin) {
	return createSaleAdminService(
		store ??
			creating(async () => new Ok({ id: "sale-1", productId: PRODUCT_ID })),
		() => NOW,
	);
}

describe("create", () => {
	it("stores the sale and describes it as an upcoming sale with all its stock", async () => {
		const stored: unknown[] = [];
		const created = await serviceWith(
			creating(async (sale) => {
				stored.push(sale);
				return new Ok({ id: "sale-9", productId: PRODUCT_ID });
			}),
		).create(draft, userIdOf(ACTOR));
		expect(created.isOk() && created.value).toEqual({
			id: "sale-9",
			productId: PRODUCT_ID,
			name: "Flash sale",
			status: "upcoming",
			startsAt: draft.startsAt,
			endsAt: draft.endsAt,
			stock: 5,
			remaining: 5,
		});
		expect(stored).toHaveLength(1);
	});

	it("does not ask the store when the sale cannot work", async () => {
		let asked = 0;
		const created = await serviceWith(
			creating(async () => {
				asked += 1;
				return new Ok({ id: "sale-1", productId: PRODUCT_ID });
			}),
		).create({ ...draft, stock: 0 }, userIdOf(ACTOR));
		expect(created.isErr() && created.error).toBe("invalid_sale");
		expect(asked).toBe(0);
	});

	it("passes on the refusal of the store", async () => {
		const created = await serviceWith(
			creating(async () => new Err("sale_overlaps")),
		).create(draft, userIdOf(ACTOR));
		expect(created.isErr() && created.error).toBe("sale_overlaps");
	});
});

describe("changing, removing and listing", () => {
	const upcoming = fakeSale({
		id: "00000000-0000-4000-8000-000000000001",
		startsAt: new Date("2026-06-01T13:00:00Z"),
		endsAt: new Date("2026-06-01T14:00:00Z"),
		stock: 5,
	});
	const running = fakeSale({
		id: "00000000-0000-4000-8000-000000000002",
		startsAt: new Date("2026-06-01T11:00:00Z"),
		endsAt: new Date("2026-06-01T12:30:00Z"),
		stock: 5,
		sold: 2,
	});
	const serviceOver = (sales: Sale[]) =>
		createSaleAdminService(memorySaleAdmin(sales), () => NOW);

	it("changes a sale and describes it as it is now", async () => {
		const changed = await serviceOver([{ ...upcoming }]).update(
			upcoming.id,
			{ stock: 9 },
			userIdOf(ACTOR),
		);
		expect(changed.isOk() && changed.value).toMatchObject({
			id: upcoming.id,
			status: "upcoming",
			stock: 9,
			remaining: 9,
		});
	});

	it("never asks the store about an id that cannot exist", async () => {
		const service = serviceOver([]);
		const changed = await service.update(
			"not-a-uuid",
			{ stock: 9 },
			userIdOf(ACTOR),
		);
		const removed = await service.remove("not-a-uuid", userIdOf(ACTOR));
		expect(changed.isErr() && changed.error).toBe("sale_not_found");
		expect(removed.isErr() && removed.error).toBe("sale_not_found");
	});

	it("passes on the refusals of the rules and of the store", async () => {
		const sales = [{ ...upcoming }, { ...running }];
		const service = serviceOver(sales);
		const locked = await service.update(
			running.id,
			{ startsAt: "2026-06-01T11:30:00.000Z" },
			userIdOf(ACTOR),
		);
		expect(locked.isErr() && locked.error).toBe("sale_locked");
		const overlapping = await service.update(
			upcoming.id,
			{ startsAt: "2026-06-01T12:00:00.000Z" },
			userIdOf(ACTOR),
		);
		expect(overlapping.isErr() && overlapping.error).toBe("sale_overlaps");
		const unknown = await service.update(
			"00000000-0000-4000-8000-000000000003",
			{ stock: 9 },
			userIdOf(ACTOR),
		);
		expect(unknown.isErr() && unknown.error).toBe("sale_not_found");
	});

	it("removes a sale nobody bought from and refuses one that was", async () => {
		const sales = [{ ...upcoming }, { ...running }];
		const service = serviceOver(sales);
		const refused = await service.remove(running.id, userIdOf(ACTOR));
		expect(refused.isErr() && refused.error).toBe("sale_has_purchases");
		const removed = await service.remove(upcoming.id, userIdOf(ACTOR));
		expect(removed.isOk()).toBe(true);
		expect(sales.map((sale) => sale.id)).toEqual([running.id]);
	});

	it("lists every sale, the one that opens last first, with the operator numbers", async () => {
		const listed = await serviceOver([{ ...running }, { ...upcoming }]).list();
		expect(listed.map((sale) => sale.id)).toEqual([upcoming.id, running.id]);
		expect(listed[1]).toMatchObject({
			status: "active",
			sold: 2,
			remaining: 3,
			holdSeconds: 120,
			admitPerSecond: 50,
		});
	});
});
