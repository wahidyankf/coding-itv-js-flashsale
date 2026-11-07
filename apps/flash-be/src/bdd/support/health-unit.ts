// The health steps' unit layer: each dependency is a switch the scenario flips, and the app is built on those switches for
// each request. No socket is opened, so a dropped connection is a flag the Redis check reads.
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../adapters/inbound/http/app.js";
import type { HealthWorld } from "./bind-health.js";
import { healthyDeps } from "./deps.js";

// A new scenario: both dependencies answer until a step says otherwise. `apps` collects each app so the file closes it.
export function unitHealthWorld(apps: FastifyInstance[]): HealthWorld {
	let databaseUp = true;
	let redisUp = true;
	const checkDatabase = async () => {
		if (!databaseUp) throw new Error("unavailable");
	};
	const checkGate = async () => {
		if (!redisUp) throw new Error("connection dropped");
	};
	return {
		breakDatabase: async () => {
			databaseUp = false;
		},
		breakRedis: async () => {
			redisUp = false;
		},
		startApi: async () => {},
		dropRedisConnection: async () => {
			redisUp = false;
		},
		redisReconnects: async () => {
			redisUp = true;
		},
		get: (url) => {
			const app = buildApp(
				{ ...healthyDeps, checkDatabase, checkGate },
				{ cookieSecure: false },
			);
			apps.push(app);
			return app.inject({ method: "GET", url });
		},
	};
}
