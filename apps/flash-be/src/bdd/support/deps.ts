import type { Dependencies } from "../../app.js";

// Dependencies that always answer, for scenarios that do not test a failure. There is no sale.
export const healthyDeps: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: {
		current: async () => undefined,
		byId: async () => undefined,
	},
};
