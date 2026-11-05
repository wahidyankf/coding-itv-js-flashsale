import type { Dependencies } from "../../app.js";

const noSale = async () => undefined;

// Dependencies that always answer, for scenarios that do not test a failure. There is no sale.
export const healthyDeps: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: { current: noSale, byId: noSale, details: noSale },
	queue: {
		join: async () => ({ ok: false, error: "sale_not_found" }),
		check: async () => ({ ok: false, error: "sale_not_found" }),
		admitTick: async () => [],
	},
	reservations: {
		reserve: async () => ({ ok: false, error: "sale_not_found" }),
	},
	rateLimiter: { check: async () => ({ limited: false }) },
	purchases: {
		confirm: async () => ({ ok: false, error: "sale_not_found" }),
		outcome: async () => ({ ok: false, error: "sale_not_found" }),
	},
};
