// The dependencies of an app that answers as healthy, with no sale and no login. Tests that need no database or Redis
// use them, and a scenario overrides the part it tests.
import { Err } from "@flash/typekit";
import type { Dependencies } from "../../application/dependencies.js";

const noSale = async () => undefined;

// Dependencies that always answer, for scenarios that do not test a failure. There is no sale.
export const healthyDeps: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: { cacheMs: () => 0, current: noSale, byId: noSale, details: noSale },
	auth: {
		register: async () => new Err("invalid_user"),
		login: async () => new Err("invalid_credentials"),
		refresh: async () => new Err("invalid_refresh_token"),
		logout: async () => {},
		authenticate: async () => new Err("not_authenticated"),
		authorizeOperator: async () => new Err("not_authenticated"),
		createOperator: async () => new Err("invalid_user"),
	},
	admin: {
		create: async () => new Err("sale_overlaps"),
		update: async () => new Err("sale_not_found"),
		remove: async () => new Err("sale_not_found"),
		list: async () => [],
	},
	queue: {
		join: async () => new Err("sale_not_found"),
		check: async () => new Err("sale_not_found"),
		admitTick: async () => [],
	},
	reservations: {
		reserve: async () => new Err("sale_not_found"),
	},
	rateLimiter: {
		check: async () => ({ limited: false }),
		checkAuth: async () => ({ limited: false }),
	},
	purchases: {
		confirm: async () => new Err("sale_not_found"),
		outcome: async () => new Err("sale_not_found"),
	},
};
