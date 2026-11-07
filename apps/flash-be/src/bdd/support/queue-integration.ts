// The integration layer of a queue scenario: the real app over the run's Postgres database and the test Redis index.
// Scenarios share the connections, but each one has its own sale, so their queues and holds never meet. The steps
// are the same as the unit layer's (queue-world.ts), done over the stores instead of in memory.

import { randomUUID } from "node:crypto";
import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { createMemoryRateLimitStore } from "../../adapters/outbound/memory/memory-rate-limit-store.js";
import { createMockPayment } from "../../adapters/outbound/payment/mock-payment.js";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import { createPurchaseRepository } from "../../adapters/outbound/postgres/purchase-repository.js";
import { createReservationRepository } from "../../adapters/outbound/postgres/reservation-repository.js";
import type { RedisClient } from "../../adapters/outbound/redis/redis-client.js";
import { createRedis } from "../../adapters/outbound/redis/redis-client.js";
import { createRedisHoldGate } from "../../adapters/outbound/redis/redis-hold-gate.js";
import { createRedisQueueStore } from "../../adapters/outbound/redis/redis-queue-store.js";
import { createRedisRateLimitStore } from "../../adapters/outbound/redis/redis-rate-limit-store.js";
import { systemClock } from "../../adapters/outbound/system/system-clock.js";
import { admitCurrentSale } from "../../application/admission.js";
import type { Dependencies } from "../../application/dependencies.js";
import { createGuardedGate } from "../../application/guarded-gate.js";
import type { QueueStore } from "../../application/ports/queue-store.js";
import type { ReservationRepository } from "../../application/ports/reservation-repository.js";
import type { PurchaseService } from "../../application/purchase-service.js";
import { createPurchaseService } from "../../application/purchase-service.js";
import type {
	RateLimiter,
	RateLimits,
} from "../../application/rate-limiter.js";
import { createRateLimiter } from "../../application/rate-limiter.js";
import type { ReservationService } from "../../application/reservation-service.js";
import { createReservationService } from "../../application/reservation-service.js";
import { dependenciesFrom, REBUILD_WAIT_MS } from "../../composition.js";
import { config } from "../../config.js";
import { normalizeUser } from "../../domain/user.js";
import { eventRequests } from "./queue-events.js";
import {
	limitRequests,
	purchaseRequests,
	queueRequests,
	reserveRequests,
	saleRequests,
} from "./queue-requests.js";
import {
	ADMIT_EVERYONE_WAITING,
	LIMITS_OUT_OF_REACH,
	notWired,
	type ShopScenario,
} from "./queue-scenario.js";
import { QUEUE_OPTIONS } from "./queue-world.js";
import { insertPurchase, insertSale, loginAs } from "./seed.js";
import { switchable } from "./switchable.js";

// The stores, services and switches the whole run shares. Each scenario reads them through `scenario()`.
type IntegrationParts = {
	redis: RedisClient;
	redisState: { down: boolean };
	cache: { ttlMs: number };
	payment: ReturnType<typeof createMockPayment>;
	limits: RateLimits;
	writes: { broken: boolean };
	closedDb: Kysely<Database>;
	base: Dependencies;
	queueStore: QueueStore;
	app: FastifyInstance;
};

// The parts a run shares: the real dependencies over Redis (flaky on a switch), a second Postgres handle that cannot
// connect, and the app over them.
function integrationParts(
	db: Kysely<Database>,
	redis: RedisClient,
): IntegrationParts {
	// What the app sees. While `redisState.down` is set, every call fails; the data in Redis is untouched.
	const redisState = { down: false };
	const flaky = switchable(redis, () => redisState.down);
	// The cache time starts at zero, so a scenario only meets the cache when it asks for it.
	const cache = { ttlMs: 0 };
	const base = dependenciesFrom(db, flaky, config, systemClock, cache);

	// A second database handle that points at a port nobody listens on. Saving through it fails the way an
	// unreachable Postgres does, while the rest of the app keeps its working connection.
	const unreachable = new URL(config.databaseUrl);
	unreachable.port = "1";
	const closedDb = createDb(unreachable.toString());
	const working = createReservationRepository(db);
	const failing = createReservationRepository(closedDb);
	const writes = { broken: false };
	const reservationRepository: ReservationRepository = {
		hasPurchase: (saleId, user) => working.hasPurchase(saleId, user),
		save: (row) => (writes.broken ? failing : working).save(row),
		rebuild: (saleId, now, restore) => working.rebuild(saleId, now, restore),
		reserveWithoutGate: (request, gateReady) =>
			working.reserveWithoutGate(request, gateReady),
	};
	// One gate for the reservations and the purchases, as the app wires them: a sale one of them marks stale is stale for both.
	const gate = createGuardedGate(createRedisHoldGate(flaky));
	const reservations: ReservationService = createReservationService({
		gate,
		repository: reservationRepository,
		sales: base.sales,
		queue: base.queue,
		clock: systemClock,
		newId: randomUUID,
		options: {
			rebuildWaitMs: REBUILD_WAIT_MS,
			wait: sleep,
			random: Math.random,
		},
	});
	// Latency and declines are zero until a scenario asks for them, so the default 2 percent never decides a result.
	const payment = createMockPayment({ latencyMs: 0, failureRate: 0 });
	const purchases: PurchaseService = createPurchaseService(
		createPurchaseRepository(db),
		payment,
		gate,
		base.sales,
		systemClock,
	);
	const limits: RateLimits = { ...LIMITS_OUT_OF_REACH };
	const rateLimiter: RateLimiter = createRateLimiter(
		createRedisRateLimitStore(flaky),
		createMemoryRateLimitStore(),
		systemClock,
		limits,
	);
	const app = buildApp(
		{ ...base, reservations, purchases, rateLimiter },
		// Streams read often in tests, so a change shows within a few milliseconds.
		{ events: { intervalMs: 20, heartbeatMs: 15_000 } },
	);
	return {
		redis,
		redisState,
		cache,
		payment,
		limits,
		writes,
		closedDb,
		base,
		// The test scaffolding admits shoppers straight in Redis, whether or not the app can reach it.
		queueStore: createRedisQueueStore(redis),
		app,
	};
}

// The sale rows and the line, as a scenario changes them. The sale is the one the scenario is on, read when needed.
function saleRowActions(
	db: Kysely<Database>,
	parts: IntegrationParts,
	current: () => ShopScenario,
) {
	return {
		async addSale(overrides: Parameters<ShopScenario["addSale"]>[0]) {
			const now = new Date();
			const saleId = await insertSale(db, {
				stock: overrides.stock,
				sold: overrides.sold,
				startsAt: overrides.startsAt ?? new Date(now.getTime() - MS_PER_HOUR),
				endsAt: overrides.endsAt ?? new Date(now.getTime() + MS_PER_HOUR),
			});
			current().saleId = saleId;
			return saleId;
		},
		async setAdmitRate(perSecond: number) {
			await db
				.updateTable("sales")
				.set({ admit_per_second: perSecond })
				.where("id", "=", current().saleId)
				.execute();
		},
		async setHoldSeconds(seconds: number) {
			await db
				.updateTable("sales")
				.set({ reservation_ttl_seconds: seconds })
				.where("id", "=", current().saleId)
				.execute();
		},
		async setSold(sold: number) {
			await db
				.updateTable("sales")
				.set({ sold })
				.where("id", "=", current().saleId)
				.execute();
		},
		// With no sale named, it is the tick the server runs: for the sale shoppers are shown now.
		async admit(saleId?: string) {
			if (saleId === undefined) {
				await admitCurrentSale(parts.base.sales, parts.base.queue);
			} else {
				await parts.base.queue.admitTick(saleId);
			}
		},
		async admitted(user: string) {
			await current().join(user);
			await parts.queueStore.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				new Date(),
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async admitMany(users: string[]) {
			for (const user of users) await current().join(user);
			await parts.queueStore.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				new Date(),
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async loseQueue() {
			await parts.redis.flushDb();
		},
		async loseReservationState() {
			const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
			await parts.redis.del(
				names.map((name) => `sale:${current().saleId}:${name}`),
			);
		},
		async openSale() {
			await db
				.updateTable("sales")
				.set({ starts_at: new Date(Date.now() - MS_PER_HOUR) })
				.where("id", "=", current().saleId)
				.execute();
			await parts.base.queue.admitTick(current().saleId);
		},
		async sellLastItemTo(user: string) {
			await insertPurchase(db, { saleId: current().saleId, user });
			await db
				.updateTable("sales")
				.set({ sold: sql`stock` })
				.where("id", "=", current().saleId)
				.execute();
		},
	};
}

// Time and payment: the wait is real here, and the payment's latency and declines are set in the database of the app.
function timeAndPaymentActions(
	parts: IntegrationParts,
	current: () => ShopScenario,
) {
	return {
		async advance(seconds: number) {
			await sleep(seconds * MS_PER_SECOND);
		},
		async setPaymentDeclines() {
			parts.payment.settings.failureRate = 1;
		},
		async setPaymentDuration(seconds: number) {
			parts.payment.settings.latencyMs = seconds * MS_PER_SECOND;
		},
		async wasRefunded(user: string) {
			const id = current().holds.get(user)?.reservationId;
			return parts.payment.refunded.includes(`mock-${id}`);
		},
	};
}

// Faults and limits: Redis stops answering, the writes break, and the limits and the cache move.
function faultActions(parts: IntegrationParts) {
	return {
		async breakWrites() {
			parts.writes.broken = true;
		},
		async fixWrites() {
			parts.writes.broken = false;
		},
		async breakRedis() {
			parts.redisState.down = true;
		},
		async fixRedis() {
			parts.redisState.down = false;
		},
		async setUserLimit(requests: number, seconds: number) {
			parts.limits.perUser = requests;
			parts.limits.windowSeconds = seconds;
		},
		async setAddressLimit(requests: number, seconds: number) {
			parts.limits.perIp = requests;
			parts.limits.windowSeconds = seconds;
		},
		async setSaleCache(ms: number) {
			parts.cache.ttlMs = ms;
		},
	};
}

// One scenario over the run's parts. Its cookies are its own, so each scenario logs its shoppers in afresh.
function integrationScenario(
	db: Kysely<Database>,
	parts: IntegrationParts,
): ShopScenario {
	const cookies = new Map<string, string>();
	const scenario: ShopScenario = {
		saleId: "",
		response: undefined,
		login: async (user) => {
			const name = normalizeUser(user) ?? user;
			const known = cookies.get(name);
			if (known !== undefined) return known;
			const cookie = await loginAs(db, name);
			cookies.set(name, cookie);
			return cookie;
		},
		tickets: new Map(),
		holds: new Map(),
		purchases: new Map(),
		replies: [],
		watcher: undefined,
		join: notWired,
		check: notWired,
		reserve: notWired,
		reserveAll: notWired,
		repeat: notWired,
		joinMany: notWired,
		readSale: notWired,
		readCurrentSale: notWired,
		watchSale: notWired,
		watchPlace: notWired,
		confirm: notWired,
		startConfirm: notWired,
		finishConfirm: notWired,
		confirmAllHolders: notWired,
		outcome: notWired,
		saleView: notWired,
		...saleRowActions(db, parts, () => scenario),
		...timeAndPaymentActions(parts, () => scenario),
		...faultActions(parts),
	};
	Object.assign(
		scenario,
		queueRequests(parts.app, scenario),
		reserveRequests(parts.app, scenario),
		purchaseRequests(parts.app, scenario),
		saleRequests(parts.app, scenario),
		eventRequests(parts.app, scenario),
	);
	return Object.assign(scenario, limitRequests(scenario));
}

// Opens the run's connections and app. `scenario()` makes one scenario; `resetSettings` puts the switches back before a
// scenario; `close` ends the connections when the run ends.
export async function openQueueIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const parts = integrationParts(db, redis);
	return {
		db,
		// Puts the payment back to "instant and never declined", and the limits out of reach, before a scenario.
		resetSettings() {
			parts.payment.settings.latencyMs = 0;
			parts.payment.settings.failureRate = 0;
			Object.assign(parts.limits, LIMITS_OUT_OF_REACH);
			parts.cache.ttlMs = 0;
			parts.redisState.down = false;
		},
		scenario: (): ShopScenario => integrationScenario(db, parts),
		async close() {
			await parts.app.close();
			await redis.close();
			await db.destroy();
			await parts.closedDb.destroy();
		},
	};
}
