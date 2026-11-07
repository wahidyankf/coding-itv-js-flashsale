import { type Kysely, sql } from "kysely";
import { createScryptHasher } from "./adapters/outbound/crypto/scrypt-hasher.js";
import { createMemoryRateLimitStore } from "./adapters/outbound/memory/memory-rate-limit-store.js";
import { createMockPayment } from "./adapters/outbound/payment/mock-payment.js";
import { createAccountStore } from "./adapters/outbound/postgres/account-store.js";
import type { Database } from "./adapters/outbound/postgres/database.js";
import { createPurchaseRepository } from "./adapters/outbound/postgres/purchase-repository.js";
import { createReservationRepository } from "./adapters/outbound/postgres/reservation-repository.js";
import { createPostgresSaleAdmin } from "./adapters/outbound/postgres/sale-admin.js";
import { createSaleRepository } from "./adapters/outbound/postgres/sale-repository.js";
import { createSessionStore } from "./adapters/outbound/postgres/session-store.js";
import type { RedisClient } from "./adapters/outbound/redis/redis-client.js";
import { createRedisHoldGate } from "./adapters/outbound/redis/redis-hold-gate.js";
import { createRedisQueueStore } from "./adapters/outbound/redis/redis-queue-store.js";
import { createRedisRateLimitStore } from "./adapters/outbound/redis/redis-rate-limit-store.js";
import { createCachedSessionStore } from "./adapters/outbound/redis/redis-session-cache.js";
import { systemClock } from "./adapters/outbound/system/system-clock.js";
import { createAuthService } from "./application/auth-service.js";
import type { Dependencies } from "./application/dependencies.js";
import { createGuardedGate } from "./application/guarded-gate.js";
import type { Clock } from "./application/ports/clock.js";
import { createPurchaseService } from "./application/purchase-service.js";
import {
	createQueueService,
	type QueueOptions,
} from "./application/queue-service.js";
import {
	createRateLimiter,
	type RateLimits,
} from "./application/rate-limiter.js";
import { createReservationService } from "./application/reservation-service.js";
import { createSaleAdminService } from "./application/sale-admin-service.js";
import type { SaleCacheSettings } from "./application/sale-cache.js";
import { createSaleService } from "./application/sale-service.js";

export type RateLimitSettings = {
	rateLimitWindowSeconds: number;
	rateLimitPerUser: number;
	rateLimitPerIp: number;
	authRateLimitPerIp: number;
};

export type SaleCacheOptions = { saleCacheMs: number };

export type PaymentSettings = {
	paymentLatencyMs: number;
	paymentFailureRate: number;
};

// The composition root: the one place that knows which adapter sits behind each port.
export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
	settings: QueueOptions &
		PaymentSettings &
		RateLimitSettings &
		SaleCacheOptions,
	clock: Clock = systemClock,
	// Tests pass their own, so a scenario can change the cache time while the app runs.
	cache: SaleCacheSettings = { ttlMs: settings.saleCacheMs },
): Dependencies {
	const sales = createSaleService(createSaleRepository(db), clock, cache);
	const gate = createGuardedGate(createRedisHoldGate(redis));
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
		auth: createAuthService(
			createAccountStore(db),
			// Postgres has the last word on a session; Redis only answers faster.
			createCachedSessionStore(createSessionStore(db), redis),
			createScryptHasher(),
			clock,
		),
		sales,
		admin: createSaleAdminService(createPostgresSaleAdmin(db), clock),
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
		rateLimiter: createRateLimiter(
			createRedisRateLimitStore(redis),
			createMemoryRateLimitStore(),
			clock,
			rateLimitsFrom(settings),
		),
	};
}

function rateLimitsFrom(settings: RateLimitSettings): RateLimits {
	return {
		windowSeconds: settings.rateLimitWindowSeconds,
		perUser: settings.rateLimitPerUser,
		perIp: settings.rateLimitPerIp,
		authPerIp: settings.authRateLimitPerIp,
	};
}
