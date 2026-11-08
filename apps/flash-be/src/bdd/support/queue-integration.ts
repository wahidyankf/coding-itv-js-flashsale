// The integration layer of a queue scenario: the real app over the run's Postgres database and the test Redis index.
// Scenarios share the connections, but each one has its own sale, so their queues and holds never meet. The steps
// are the same as the unit layer's (queue-world.ts), done over the stores instead of in memory.

import { randomUUID } from "node:crypto";
import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { expect } from "vitest";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "../../adapters/inbound/http/event-stream.js";
import { createMemoryRateLimitStore } from "../../adapters/outbound/memory/memory-rate-limit-store.js";
import type { MockPayment } from "../../adapters/outbound/payment/mock-payment.js";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import { createPostgresPaymentLedger } from "../../adapters/outbound/postgres/payment-ledger.js";
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
import { type Config, config } from "../../config.js";
import { normalizeUser } from "../../domain/user.js";
import { holdRowsOf } from "./hold-rows.js";
import { limitActions } from "./limit-actions.js";
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
	placeholders,
	type ShopScenario,
} from "./queue-scenario.js";
import { insertPurchase, insertSale, loginAs } from "./seed.js";
import type { ShopLayer } from "./shop-steps.js";
import { switchable } from "./switchable.js";
import {
	confirmOnBoth,
	giveBackNextCharge,
	setProvider,
	twoPayments,
} from "./two-instances.js";

// The stores, services and switches the whole run shares. Each scenario reads them through `scenario()`.
type IntegrationParts = {
	redis: RedisClient;
	redisState: { down: boolean };
	cache: { ttlMs: number };
	payment: MockPayment;
	// The payments of both instances, which a provider setting changes together.
	payments: MockPayment[];
	limits: RateLimits;
	// The run's copy of the server settings. The queue reads its admission time from it, so a scenario can shorten it.
	settings: Config;
	writes: { broken: boolean };
	closedDb: Kysely<Database>;
	base: Dependencies;
	queueStore: QueueStore;
	app: FastifyInstance;
	// A second instance of the API, with its own payment over the same ledger.
	secondApp: FastifyInstance;
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
	const settings: Config = { ...config };
	const base = dependenciesFrom(db, flaky, settings, systemClock, cache);

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
	// Latency and declines are zero until a scenario asks for them, so the default 2 percent never decides a result. The
	// second payment is a second instance's, over the same ledger in Postgres.
	const [payment, secondPayment] = twoPayments(createPostgresPaymentLedger(db));
	const purchasesWith = (pay: MockPayment): PurchaseService =>
		createPurchaseService(
			createPurchaseRepository(db),
			pay,
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
	const appWith = (pay: MockPayment) =>
		buildApp(
			{ ...base, reservations, purchases: purchasesWith(pay), rateLimiter },
			// Streams read often in tests, so a change shows within a few milliseconds.
			{
				cookieSecure: false,
				events: { ...DEFAULT_STREAM_OPTIONS, intervalMs: 20 },
			},
		);
	const app = appWith(payment);
	return {
		redis,
		redisState,
		cache,
		payment,
		payments: [payment, secondPayment],
		limits,
		settings,
		writes,
		closedDb,
		base,
		// The test scaffolding admits shoppers straight in Redis, whether or not the app can reach it.
		queueStore: createRedisQueueStore(redis),
		app,
		secondApp: appWith(secondPayment),
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
		async setAdmissionSeconds(seconds: number) {
			parts.settings.admissionTtlSeconds = seconds;
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
		async endSale() {
			await db
				.updateTable("sales")
				.set({ ends_at: new Date(Date.now() - MS_PER_SECOND) })
				.where("id", "=", current().saleId)
				.execute();
		},
		// With no sale named, admit the sale the admission timer picks now, the same rule as GET /api/v1/sales/current.
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
				parts.settings.admissionTtlSeconds,
			);
		},
		async admitMany(users: string[]) {
			for (const user of users) await current().join(user);
			await parts.queueStore.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				new Date(),
				parts.settings.admissionTtlSeconds,
			);
		},
		async loseQueue() {
			await parts.redis.flushDb();
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

// Time and payment: the wait is real here, and the payment's latency and declines are set on the payment the app uses.
function timeAndPaymentActions(
	parts: IntegrationParts,
	current: () => ShopScenario,
) {
	return {
		async advance(seconds: number) {
			await sleep(seconds * MS_PER_SECOND);
		},
		async setPaymentDeclines() {
			setProvider(parts.payments, { failureRate: 1 });
		},
		async setPaymentDuration(seconds: number) {
			setProvider(parts.payments, { latencyMs: seconds * MS_PER_SECOND });
		},
		async setPaymentAccepts() {
			setProvider(parts.payments, { failureRate: 0 });
		},
		giveBackNextCharge: async () => giveBackNextCharge(parts.payment),
		async paymentOf(user: string) {
			const id = current().holds.get(user)?.reservationId;
			return id === undefined ? undefined : await parts.payment.statusOf(id);
		},
	};
}

// Faults and the cache: Redis stops answering, the writes break, and the cache time moves. The limits are in limit-actions.ts.
function faultActions(parts: IntegrationParts, current: () => ShopScenario) {
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
		// The lock a rebuild on another instance would hold, with the owner's token, for an hour: longer than any wait.
		async holdRebuildLock() {
			await parts.redis.set(
				`sale:${current().saleId}:rebuild-lock`,
				"another-instance",
				{ expiration: { type: "PX", value: MS_PER_HOUR } },
			);
		},
		async loseReservationState() {
			const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
			await parts.redis.del(
				names.map((name) => `sale:${current().saleId}:${name}`),
			);
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
		...placeholders(),
		...saleRowActions(db, parts, () => scenario),
		...timeAndPaymentActions(parts, () => scenario),
		...faultActions(parts, () => scenario),
		...limitActions(parts.limits),
		holdRows: () => holdRowsOf(db, scenario.saleId),
		confirmOnTwoInstances: (user) =>
			confirmOnBoth([parts.app, parts.secondApp], scenario, user),
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
		// Puts the payment back to "instant and never declined", the limits out of reach, and the admission time to the
		// server's, before a scenario.
		resetSettings() {
			setProvider(parts.payments, { latencyMs: 0, failureRate: 0 });
			Object.assign(parts.limits, LIMITS_OUT_OF_REACH);
			parts.cache.ttlMs = 0;
			parts.redisState.down = false;
			parts.settings.admissionTtlSeconds = config.admissionTtlSeconds;
		},
		scenario: (): ShopScenario => integrationScenario(db, parts),
		async close() {
			await parts.app.close();
			await parts.secondApp.close();
			await redis.close();
			await db.destroy();
			await parts.closedDb.destroy();
		},
	};
}

// How far a hold's end may differ from the test's clock. The app and the test read the same wall clock a few milliseconds
// apart.
const HOLD_END_TOLERANCE_MS = 5000;

// The integration layer's ShopLayer over the run's real stores: sales are timed from the wall clock when the layer is
// made, and a hold's end is checked within the tolerance above, because the app runs on real time.
export function integrationShopLayer(newWorld: () => ShopScenario): ShopLayer {
	return {
		now: new Date(),
		newWorld,
		expectHoldEndsIn: (endsAt, seconds) => {
			expect(
				Math.abs(endsAt - Date.now() - seconds * MS_PER_SECOND),
			).toBeLessThan(HOLD_END_TOLERANCE_MS);
		},
	};
}
