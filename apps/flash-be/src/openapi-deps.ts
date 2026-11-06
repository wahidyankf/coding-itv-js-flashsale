// Dependencies for describing the routes. Nothing calls them: the document is made from the routes alone.
import { Err } from "@flash/typekit";
import type { Dependencies } from "./application/dependencies.js";

const noSale = async () => undefined;
export const unusedDependencies: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: { cacheMs: () => 0, current: noSale, byId: noSale, details: noSale },
	queue: {
		join: async () => new Err("sale_not_found"),
		check: async () => new Err("sale_not_found"),
		admitTick: async () => [],
	},
	reservations: { reserve: async () => new Err("sale_not_found") },
	rateLimiter: { check: async () => ({ limited: false }) },
	purchases: {
		confirm: async () => new Err("sale_not_found"),
		outcome: async () => new Err("sale_not_found"),
	},
};
