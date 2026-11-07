import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../adapters/inbound/http/app.js";
import type { Clock } from "../../application/ports/clock.js";
import type { SaleRepository } from "../../application/ports/sale-repository.js";
import { createSaleService } from "../../application/sale-service.js";
import { pickCurrent, type Sale } from "../../domain/sale.js";
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
		findCurrent: async (now) => {
			const found = pickCurrent(sales, now);
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
