import { sql } from "kysely";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { createMemoryRateLimitStore } from "../../adapters/outbound/memory/memory-rate-limit-store.js";
import { createMockPayment } from "../../adapters/outbound/payment/mock-payment.js";
import { createDb } from "../../adapters/outbound/postgres/database.js";
import { createPurchaseRepository } from "../../adapters/outbound/postgres/purchase-repository.js";
import { createReservationRepository } from "../../adapters/outbound/postgres/reservation-repository.js";
import { createRedis } from "../../adapters/outbound/redis/redis-client.js";
import { createRedisHoldGate } from "../../adapters/outbound/redis/redis-hold-gate.js";
import { createRedisQueueStore } from "../../adapters/outbound/redis/redis-queue-store.js";
import { createRedisRateLimitStore } from "../../adapters/outbound/redis/redis-rate-limit-store.js";
import { systemClock } from "../../adapters/outbound/system/system-clock.js";
import { createGuardedGate } from "../../application/guarded-gate.js";
import { createPurchaseService } from "../../application/purchase-service.js";
import { createRateLimiter } from "../../application/rate-limiter.js";
import { createReservationService } from "../../application/reservation-service.js";
import { dependenciesFrom } from "../../composition.js";
import { config } from "../../config.js";
import {
	eventRequests,
	limitRequests,
	purchaseRequests,
	queueRequests,
	reserveRequests,
	type ShopScenario,
	saleRequests,
} from "./queue-world.js";
import { insertSale } from "./seed.js";
import { switchable } from "./switchable.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The real app over the run's Postgres database and the test Redis index. Scenarios share the connections but each
// one has its own sale, so their queues and holds never meet.
export async function openQueueIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
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
	let broken = false;
	const reservations = createReservationService(
		createGuardedGate(createRedisHoldGate(flaky)),
		{
			hasPurchase: (saleId, user) => working.hasPurchase(saleId, user),
			save: (row) => (broken ? failing : working).save(row),
			rebuild: (saleId, now, restore) => working.rebuild(saleId, now, restore),
			reserveWithoutRedis: (request, ready) =>
				working.reserveWithoutRedis(request, ready),
		},
		base.sales,
		base.queue,
		systemClock,
	);
	// Latency and declines are zero until a scenario asks for them, so the default 2 percent never decides a result.
	const payment = createMockPayment({ latencyMs: 0, failureRate: 0 });
	const gate = createGuardedGate(createRedisHoldGate(flaky));
	const purchases = createPurchaseService(
		createPurchaseRepository(db),
		payment,
		gate,
		base.sales,
		systemClock,
	);
	// Limits start far out of reach; the rate limit scenarios lower them and `resetSettings` raises them again.
	const limits = { windowSeconds: 60, perUser: 100_000, perIp: 100_000 };
	const rateLimiter = createRateLimiter(
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
	// The test scaffolding admits shoppers straight in Redis, whether or not the app can reach it.
	const queueStore = createRedisQueueStore(redis);

	return {
		db,
		// Puts the payment back to "instant and never declined", and the limits out of reach, before a scenario.
		resetSettings() {
			payment.settings.latencyMs = 0;
			payment.settings.failureRate = 0;
			limits.windowSeconds = 60;
			limits.perUser = 100_000;
			limits.perIp = 100_000;
			cache.ttlMs = 0;
			redisState.down = false;
		},
		scenario(): ShopScenario {
			const scenario: ShopScenario = {
				saleId: "",
				response: undefined,
				tickets: new Map(),
				holds: new Map(),
				async addSale(overrides) {
					const now = new Date();
					scenario.saleId = await insertSale(db, {
						stock: overrides.stock,
						sold: overrides.sold,
						startsAt: overrides.startsAt ?? new Date(now.getTime() - 3_600_000),
						endsAt: overrides.endsAt ?? new Date(now.getTime() + 3_600_000),
					});
					return scenario.saleId;
				},
				async setAdmitRate(perSecond) {
					await db
						.updateTable("sales")
						.set({ admit_per_second: perSecond })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				async setHoldSeconds(seconds) {
					await db
						.updateTable("sales")
						.set({ reservation_ttl_seconds: seconds })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				join: notWired,
				check: notWired,
				reserve: notWired,
				reserveAll: notWired,
				async admit(saleId = scenario.saleId) {
					await base.queue.admitTick(saleId);
				},
				async admitted(user) {
					await scenario.join(user);
					await queueStore.admit(scenario.saleId, 1000, new Date(), 600);
				},
				async admitMany(users) {
					for (const user of users) await scenario.join(user);
					await queueStore.admit(scenario.saleId, 1000, new Date(), 600);
				},
				async advance(seconds) {
					await sleep(seconds * 1000);
				},
				async loseQueue() {
					await redis.flushDb();
				},
				async loseReservationState() {
					const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
					await redis.del(
						names.map((name) => `sale:${scenario.saleId}:${name}`),
					);
				},
				async breakWrites() {
					broken = true;
				},
				async fixWrites() {
					broken = false;
				},
				purchases: new Map(),
				replies: [],
				repeat: notWired,
				joinMany: notWired,
				async setUserLimit(requests, seconds) {
					limits.perUser = requests;
					limits.windowSeconds = seconds;
				},
				async setAddressLimit(requests, seconds) {
					limits.perIp = requests;
					limits.windowSeconds = seconds;
				},
				async breakRedis() {
					redisState.down = true;
				},
				async fixRedis() {
					redisState.down = false;
				},
				async setSaleCache(ms) {
					cache.ttlMs = ms;
				},
				async setSold(sold) {
					await db
						.updateTable("sales")
						.set({ sold })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				readSale: notWired,
				readCurrentSale: notWired,
				watcher: undefined,
				watchSale: notWired,
				watchPlace: notWired,
				async openSale() {
					await db
						.updateTable("sales")
						.set({ starts_at: new Date(Date.now() - 3_600_000) })
						.where("id", "=", scenario.saleId)
						.execute();
					await base.queue.admitTick(scenario.saleId);
				},
				confirm: notWired,
				startConfirm: notWired,
				finishConfirm: notWired,
				confirmAllHolders: notWired,
				outcome: notWired,
				saleView: notWired,
				async setPaymentDeclines() {
					payment.settings.failureRate = 1;
				},
				async setPaymentDuration(seconds) {
					payment.settings.latencyMs = seconds * 1000;
				},
				async sellLastItemTo(user) {
					await db
						.insertInto("purchases")
						.values({
							sale_id: scenario.saleId,
							user_id: user,
							reservation_id: crypto.randomUUID(),
							payment_ref: `pay-${user}`,
						})
						.execute();
					await db
						.updateTable("sales")
						.set({ sold: sql`stock` })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				async wasRefunded(user) {
					const id = scenario.holds.get(user)?.reservationId;
					return payment.refunded.includes(`mock-${id}`);
				},
			};
			Object.assign(
				scenario,
				queueRequests(app, scenario),
				reserveRequests(app, scenario),
				purchaseRequests(app, scenario),
				saleRequests(app, scenario),
				eventRequests(app, scenario),
			);
			return Object.assign(scenario, limitRequests(scenario));
		},
		async close() {
			await app.close();
			await redis.close();
			await db.destroy();
			await closedDb.destroy();
		},
	};
}

function notWired(): never {
	throw new Error("replaced when the scenario is built");
}
