import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { type Clock, systemClock } from "./clock.js";
import type { Database } from "./db.js";
import { createMockPayment } from "./payment/mock-payment.js";
import { createPurchaseRepository } from "./purchases/purchase-repository.js";
import {
	createPurchaseService,
	type PurchaseService,
} from "./purchases/purchase-service.js";
import {
	createQueueService,
	type QueueOptions,
	type QueueService,
} from "./queue/queue-service.js";
import { createRedisQueueStore } from "./queue/redis-queue-store.js";
import type { RedisClient } from "./redis.js";
import { createRedisHoldGate } from "./reservations/redis-hold-gate.js";
import { createReservationRepository } from "./reservations/reservation-repository.js";
import {
	createReservationService,
	type ReservationService,
} from "./reservations/reservation-service.js";
import { registerRoutes } from "./routes.js";
import { createSaleRepository } from "./sales/sale-repository.js";
import { createSaleService, type SaleService } from "./sales/sale-service.js";

export type PaymentSettings = {
	paymentLatencyMs: number;
	paymentFailureRate: number;
};

// Everything the routes use is injected, so unit tests can fake it without a real database or Redis.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<void>;
	sales: SaleService;
	queue: QueueService;
	reservations: ReservationService;
	purchases: PurchaseService;
};

export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
	settings: QueueOptions & PaymentSettings,
	clock: Clock = systemClock,
): Dependencies {
	const sales = createSaleService(createSaleRepository(db), clock);
	const gate = createRedisHoldGate(redis);
	const queue = createQueueService(
		createRedisQueueStore(redis),
		sales,
		clock,
		settings,
	);
	return {
		checkDatabase: async () => {
			await sql`select 1`.execute(db);
		},
		checkRedis: async () => {
			await redis.ping();
		},
		sales,
		queue,
		reservations: createReservationService(
			gate,
			createReservationRepository(db),
			sales,
			queue,
			clock,
		),
		purchases: createPurchaseService(
			createPurchaseRepository(db),
			createMockPayment({
				latencyMs: settings.paymentLatencyMs,
				failureRate: settings.paymentFailureRate,
				log: console.log,
			}),
			gate,
			sales,
			clock,
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
