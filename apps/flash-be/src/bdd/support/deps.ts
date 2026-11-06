import { Err } from "@flash/typekit";
import type { Dependencies } from "../../application/dependencies.js";

const noSale = async () => undefined;

// Dependencies that always answer, for scenarios that do not test a failure. There is no sale.
export const healthyDeps: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: { cacheMs: () => 0, current: noSale, byId: noSale, details: noSale },
	admin: {
		authorize: () => new Err("not_found"),
		create: async () => new Err("sale_overlaps"),
	},
	queue: {
		join: async () => new Err("sale_not_found"),
		check: async () => new Err("sale_not_found"),
		admitTick: async () => [],
	},
	reservations: {
		reserve: async () => new Err("sale_not_found"),
	},
	rateLimiter: { check: async () => ({ limited: false }) },
	purchases: {
		confirm: async () => new Err("sale_not_found"),
		outcome: async () => new Err("sale_not_found"),
	},
};
