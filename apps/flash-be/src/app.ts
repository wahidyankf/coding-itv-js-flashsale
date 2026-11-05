import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import type { Database } from "./db.js";
import type { RedisClient } from "./redis.js";
import { registerRoutes } from "./routes.js";

// Readiness checks are injected so unit tests can fake them without a real database or Redis.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<void>;
};

export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
): Dependencies {
	return {
		checkDatabase: async () => {
			await sql`select 1`.execute(db);
		},
		checkRedis: async () => {
			await redis.ping();
		},
	};
}

export function buildApp(
	deps: Dependencies,
	options: { logger?: boolean } = {},
): FastifyInstance {
	const app = Fastify({ logger: options.logger ?? false });
	registerRoutes(app, deps);
	return app;
}
