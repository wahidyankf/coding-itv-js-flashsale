// The composition root (wiring, outermost layer): the one place that picks an adapter for each port, and that wires the
// services together. Only this file and the entry points see both the adapters and the application. The choice of the
// hexagon for the API is recorded in decision 004. The Redis gate with Postgres as the last word is in decision 002.
import { randomUUID } from "node:crypto";
import { sleep } from "@flash/flash-commons/timers";
import type { Kysely } from "kysely";
import { createScryptHasher } from "./adapters/outbound/crypto/scrypt-hasher.js";
import { randomTokenSource } from "./adapters/outbound/crypto/token-source.js";
import { createMemoryRateLimitStore } from "./adapters/outbound/memory/memory-rate-limit-store.js";
import { createMockPayment } from "./adapters/outbound/payment/mock-payment.js";
import { createAccountRepository } from "./adapters/outbound/postgres/account-repository.js";
import type { Database } from "./adapters/outbound/postgres/database.js";
import { checkDatabase } from "./adapters/outbound/postgres/health.js";
import { createPostgresPaymentLedger } from "./adapters/outbound/postgres/payment-ledger.js";
import { createPurchaseRepository } from "./adapters/outbound/postgres/purchase-repository.js";
import { createReservationRepository } from "./adapters/outbound/postgres/reservation-repository.js";
import { createPostgresSaleAdmin } from "./adapters/outbound/postgres/sale-admin.js";
import { createSaleRepository } from "./adapters/outbound/postgres/sale-repository.js";
import { createSessionRepository } from "./adapters/outbound/postgres/session-repository.js";
import type { RedisClient } from "./adapters/outbound/redis/redis-client.js";
import { checkGate } from "./adapters/outbound/redis/redis-health.js";
import { createRedisHoldGate } from "./adapters/outbound/redis/redis-hold-gate.js";
import { createRedisQueueStore } from "./adapters/outbound/redis/redis-queue-store.js";
import { createRedisRateLimitStore } from "./adapters/outbound/redis/redis-rate-limit-store.js";
import { createRedisSessionCache } from "./adapters/outbound/redis/redis-session-cache.js";
import { systemClock } from "./adapters/outbound/system/system-clock.js";
import {
	type AuthService,
	createAuthService,
} from "./application/auth-service.js";
import type { Dependencies } from "./application/dependencies.js";
import { createGuardedGate } from "./application/guarded-gate.js";
import type { Clock } from "./application/ports/clock.js";
import { createPurchaseService } from "./application/purchase-service.js";
import { createQueueService } from "./application/queue-service.js";
import {
	createRateLimiter,
	type RateLimits,
} from "./application/rate-limiter.js";
import { createReservationService } from "./application/reservation-service.js";
import { createSaleAdminService } from "./application/sale-admin-service.js";
import type { SaleCacheSettings } from "./application/sale-cache.js";
import { createSaleService } from "./application/sale-service.js";
import type { Config } from "./config.js";

// How long a request waits for another instance to rebuild a sale's reservation state. Long enough for a rebuild of one
// sale's holds, short enough that a shopper is not left hanging. The real timer and Math.random are passed in here; the
// application never reads them itself.
export const REBUILD_WAIT_MS = 3000;

// The settings the wiring reads, named as the configuration names them. They are picked from `Config`, so each name is
// written once.
export type WiringSettings = Pick<
	Config,
	| "ticketSecret"
	| "admissionTickMs"
	| "admissionTtlSeconds"
	| "paymentLatencyMs"
	| "paymentFailureRate"
	| "rateLimitWindowSeconds"
	| "rateLimitPerUser"
	| "rateLimitPerIp"
	| "authRateLimitPerIp"
	| "saleCacheMs"
>;

// The rate limits in the shape the rate limiter takes. Only the names change; the values are the same.
function rateLimitsFrom(settings: WiringSettings): RateLimits {
	return {
		windowSeconds: settings.rateLimitWindowSeconds,
		perUser: settings.rateLimitPerUser,
		perIp: settings.rateLimitPerIp,
		authPerIp: settings.authRateLimitPerIp,
	};
}

// Builds the services the HTTP adapter calls, each over its adapter: Postgres for records, Redis for fast state, memory
// for the rate limit when Redis is down, and a mock payment. Tests pass `clock` and `cache`, so a scenario can fix the
// time or change the cache while the app runs.
export function dependenciesFrom(
	db: Kysely<Database>,
	redis: RedisClient,
	settings: WiringSettings,
	clock: Clock = systemClock,
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
		checkDatabase: () => checkDatabase(db),
		checkGate: () => checkGate(redis),
		auth: createAuthService(
			createAccountRepository(db),
			// Postgres has the last word on a session; Redis only answers faster.
			createRedisSessionCache(createSessionRepository(db), redis),
			createScryptHasher(),
			clock,
			randomTokenSource,
		),
		sales,
		saleCache: cache,
		admin: createSaleAdminService(createPostgresSaleAdmin(db), clock),
		queue,
		reservations: createReservationService({
			gate,
			repository: createReservationRepository(db),
			sales,
			queue,
			clock,
			newId: randomUUID,
			options: {
				rebuildWaitMs: REBUILD_WAIT_MS,
				wait: sleep,
				random: Math.random,
			},
		}),
		purchases: createPurchaseService(
			createPurchaseRepository(db),
			createMockPayment({
				ledger: createPostgresPaymentLedger(db),
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

// The login and account rules over Postgres alone, for the command that makes an operator. That command runs without
// Redis, so it gets no cached session store.
export function postgresAuth(db: Kysely<Database>): AuthService {
	return createAuthService(
		createAccountRepository(db),
		createSessionRepository(db),
		createScryptHasher(),
		systemClock,
		randomTokenSource,
	);
}
