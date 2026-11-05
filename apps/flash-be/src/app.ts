import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { type Clock, systemClock } from "./clock.js";
import type { Database } from "./db.js";
import type { RedisClient } from "./redis.js";
import { registerRoutes } from "./routes.js";
import { createSaleRepository } from "./sales/sale-repository.js";
import { createSaleService, type SaleService } from "./sales/sale-service.js";

// Everything the routes use is injected, so unit tests can fake it without a real database or Redis.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<void>;
	sales: SaleService;
};

export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
	clock: Clock = systemClock,
): Dependencies {
	return {
		checkDatabase: async () => {
			await sql`select 1`.execute(db);
		},
		checkRedis: async () => {
			await redis.ping();
		},
		sales: createSaleService(createSaleRepository(db), clock),
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
