import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { type Clock, systemClock } from "./clock.js";
import type { Database } from "./db.js";
import {
	createQueueService,
	type QueueOptions,
	type QueueService,
} from "./queue/queue-service.js";
import { createRedisQueueStore } from "./queue/redis-queue-store.js";
import type { RedisClient } from "./redis.js";
import { registerRoutes } from "./routes.js";
import { createSaleRepository } from "./sales/sale-repository.js";
import { createSaleService, type SaleService } from "./sales/sale-service.js";

// Everything the routes use is injected, so unit tests can fake it without a real database or Redis.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<void>;
	sales: SaleService;
	queue: QueueService;
};

export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
	settings: QueueOptions,
	clock: Clock = systemClock,
): Dependencies {
	const sales = createSaleService(createSaleRepository(db), clock);
	return {
		checkDatabase: async () => {
			await sql`select 1`.execute(db);
		},
		checkRedis: async () => {
			await redis.ping();
		},
		sales,
		queue: createQueueService(
			createRedisQueueStore(redis),
			sales,
			clock,
			settings,
		),
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
