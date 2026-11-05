import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { Clock } from "../../clock.js";
import type { Sale } from "../../sales/sale.js";
import type { SaleRepository } from "../../sales/sale-repository.js";
import { createSaleService } from "../../sales/sale-service.js";
import { healthyDeps } from "./deps.js";

// A sale with sensible values; a scenario overrides what it cares about.
export function fakeSale(overrides: Partial<Sale>): Sale {
	return {
		id: randomUUID(),
		name: "Flash sale",
		startsAt: new Date("2026-06-01T11:00:00Z"),
		endsAt: new Date("2026-06-01T13:00:00Z"),
		stock: 10,
		sold: 0,
		reservationTtlSeconds: 120,
		admitPerSecond: 50,
		...overrides,
	};
}

export function fakeRepository(sales: Sale[]): SaleRepository {
	return {
		// Copies, as a database does: a cache must not see later changes to the stored row.
		findById: async (id) => {
			const found = sales.find((sale) => sale.id === id);
			return found && { ...found };
		},
		findCurrent: async () => {
			const found = [...sales].sort(
				(a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
			)[0];
			return found && { ...found };
		},
	};
}

// The app over an in-memory list of sales and a fixed clock.
export function appWithSales(sales: Sale[], clock: Clock): FastifyInstance {
	return buildApp({
		...healthyDeps,
		sales: createSaleService(fakeRepository(sales), clock),
	});
}
