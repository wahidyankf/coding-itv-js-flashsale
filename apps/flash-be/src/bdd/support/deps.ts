import type { Dependencies } from "../../app.js";

// Dependencies that always answer, for scenarios that do not test a failure.
export const healthyDeps: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
};
