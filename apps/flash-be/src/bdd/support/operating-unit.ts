// The operator's steps in memory: the sales, products and logins live in the scenario, and the app is built on them.
// Removed sales are kept in a map, so the scenario can ask who removed one.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { createSaleAdminService } from "../../application/sale-admin-service.js";
import { createSaleService } from "../../application/sale-service.js";
import type { Sale } from "../../domain/sale.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository } from "./fake-sales.js";
import { memoryAuth } from "./memory-auth.js";
import { memorySaleAdmin } from "./memory-sale-admin.js";
import { operatorWorld } from "./operating.js";

// The fixed moment the unit layer of the operator features runs at, so "in 10 minutes" means the same in every run.
export const NOW = new Date("2026-06-01T12:00:00Z");
const clock = () => NOW;

// One scenario in memory: the sales, the products, the logins and the app over them. A bought item is one more sold in
// the list. `apps` collects the app so the file can close it after the run.
export function unitOperatingWorld(apps: FastifyInstance[]) {
	const sales: Sale[] = [];
	const products = new Map<string, string>();
	const removed = new Map<string, string>();
	const auth = memoryAuth(clock);
	const saleCache = { ttlMs: 0 };
	const app = buildApp(
		{
			...healthyDeps,
			auth: auth.service,
			saleCache,
			sales: createSaleService(fakeRepository(sales), clock, saleCache),
			admin: createSaleAdminService(
				memorySaleAdmin(sales, products, removed),
				clock,
			),
		},
		{ cookieSecure: false },
	);
	apps.push(app);
	return operatorWorld({
		app: () => app,
		now: clock,
		login: (username, role) => auth.login(username, role),
		buyItem: async (saleId) => {
			const sale = sales.find((candidate) => candidate.id === saleId);
			if (sale) sale.sold += 1;
		},
		salesCount: async () => sales.length,
		makeProduct: async (name) => {
			const id = randomUUID();
			products.set(id, name);
			return id;
		},
		productsOfSales: async () => [
			...new Set(sales.map((sale) => sale.productId)),
		],
		deletedBy: async (saleId) => removed.get(saleId),
		idOf: async (username) => auth.idOf(username),
	});
}
