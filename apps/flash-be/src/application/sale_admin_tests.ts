import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import type { SaleAdmin } from "./ports/sale-admin.js";
import { createSaleAdminService } from "./sale-admin-service.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const TOKEN = "operator-secret-0001";
const draft = {
	stock: 5,
	startsAt: "2026-06-01T13:00:00.000Z",
	endsAt: "2026-06-01T14:00:00.000Z",
};

function serviceWith(token: string | undefined, store?: SaleAdmin) {
	return createSaleAdminService(
		token,
		store ?? { create: async () => new Ok("sale-1") },
		() => NOW,
	);
}

describe("authorize", () => {
	it("is off when no token is set, whatever is sent", () => {
		const result = serviceWith(undefined).authorize(`Bearer ${TOKEN}`);
		expect(result.isErr() && result.error).toBe("not_found");
	});

	it.each([
		["no header", undefined],
		["another scheme", `Basic ${TOKEN}`],
		["the wrong token", "Bearer another-secret-0002"],
	])("refuses %s", (_why, header) => {
		const result = serviceWith(TOKEN).authorize(header);
		expect(result.isErr() && result.error).toBe("invalid_admin_token");
	});

	it("accepts the token", () => {
		expect(serviceWith(TOKEN).authorize(`Bearer ${TOKEN}`).isOk()).toBe(true);
	});
});

describe("create", () => {
	it("stores the sale and describes it as an upcoming sale with all its stock", async () => {
		const stored: unknown[] = [];
		const created = await serviceWith(TOKEN, {
			create: async (sale) => {
				stored.push(sale);
				return new Ok("sale-9");
			},
		}).create(draft);
		expect(created.isOk() && created.value).toEqual({
			id: "sale-9",
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
		const created = await serviceWith(TOKEN, {
			create: async () => {
				asked += 1;
				return new Ok("sale-1");
			},
		}).create({ ...draft, stock: 0 });
		expect(created.isErr() && created.error).toBe("invalid_sale");
		expect(asked).toBe(0);
	});

	it("passes on the refusal of the store", async () => {
		const created = await serviceWith(TOKEN, {
			create: async () => new Err("sale_overlaps"),
		}).create(draft);
		expect(created.isErr() && created.error).toBe("sale_overlaps");
	});
});
