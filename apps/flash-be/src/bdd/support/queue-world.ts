// The unit layer of a queue scenario: the app over in-memory stores, a clock that moves only when a scenario says so,
// and payment timers that fire only as that clock moves. The integration layer runs the same steps over Postgres and
// Redis (queue-integration.ts). The steps themselves are the request helpers in queue-requests.ts.

import { randomUUID } from "node:crypto";
import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "../../adapters/inbound/http/event-stream.js";
import { createMemoryRateLimitStore } from "../../adapters/outbound/memory/memory-rate-limit-store.js";
import { createMockPayment } from "../../adapters/outbound/payment/mock-payment.js";
import { admitCurrentSale } from "../../application/admission.js";
import { createGuardedGate } from "../../application/guarded-gate.js";
import type { Clock } from "../../application/ports/clock.js";
import type { PurchaseService } from "../../application/purchase-service.js";
import { createPurchaseService } from "../../application/purchase-service.js";
import type { QueueService } from "../../application/queue-service.js";
import { createQueueService } from "../../application/queue-service.js";
import type {
	RateLimiter,
	RateLimits,
} from "../../application/rate-limiter.js";
import { createRateLimiter } from "../../application/rate-limiter.js";
import type { ReservationService } from "../../application/reservation-service.js";
import { createReservationService } from "../../application/reservation-service.js";
import type { SaleService } from "../../application/sale-service.js";
import { createSaleService } from "../../application/sale-service.js";
import { buildConfig } from "../../config.js";
import type { Sale } from "../../domain/sale.js";
import { normalizeUser } from "../../domain/user.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository, fakeSale } from "./fake-sales.js";
import { type MemoryAuth, memoryAuth } from "./memory-auth.js";
import { type MemoryHoldGate, memoryHoldGate } from "./memory-hold-gate.js";
import {
	type MemoryPurchaseRepository,
	memoryPurchaseRepository,
} from "./memory-purchase-repository.js";
import {
	type MemoryQueueStore,
	memoryQueueStore,
} from "./memory-queue-store.js";
import {
	type MemoryReservationRepository,
	memoryReservationRepository,
} from "./memory-reservation-repository.js";
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
	type SaleOverrides,
	type ShopScenario,
} from "./queue-scenario.js";
import { sharedCounter } from "./shared-counter.js";
import type { ShopLayer } from "./shop-steps.js";
import { switchable } from "./switchable.js";
import { usernameOf } from "./users.js";

// The types a queue scenario is built from, re-exported so the unit layer's test file imports them from one place.
export type {
	EventWatcher,
	QueueScenario,
	Response,
	ShopScenario,
} from "./queue-scenario.js";

// The queue settings the unit layer runs with. The tick and the admission take the configuration defaults, so the unit
// layer and a server agree on them; only the ticket secret is set here.
const queueDefaults = buildConfig({});
// The queue settings of the unit layer: a fixed ticket secret, and the server's own tick and admission lifetime.
export const QUEUE_OPTIONS = {
	ticketSecret: "unit-secret",
	admissionTickMs: queueDefaults.admissionTickMs,
	admissionTtlSeconds: queueDefaults.admissionTtlSeconds,
};

// One queue scenario at the unit layer: the app and each in-memory store, so a step can set or read any of them.
export type UnitQueueScenario = ShopScenario & {
	app: FastifyInstance;
	store: MemoryQueueStore;
	gate: MemoryHoldGate;
	repository: MemoryReservationRepository;
	// The purchase rows and the payment, so a test can make a commit fail and read the refunds.
	purchaseRepository: MemoryPurchaseRepository;
	payment: ReturnType<typeof createMockPayment>;
	queue: QueueService;
	reservations: ReservationService;
	saleService: SaleService;
	sales: Sale[];
};

// Everything one unit scenario is built from. The actions below read and change these, and the app is built over them.
type UnitParts = {
	time: { now: Date };
	clock: Clock;
	sales: Sale[];
	redis: { down: boolean };
	timers: Array<{ at: number; resolve: () => void }>;
	store: MemoryQueueStore;
	memoryGate: MemoryHoldGate;
	repository: MemoryReservationRepository;
	purchased: MemoryPurchaseRepository;
	payment: ReturnType<typeof createMockPayment>;
	cache: { ttlMs: number };
	limits: RateLimits;
	saleService: SaleService;
	queue: QueueService;
	reservations: ReservationService;
	purchases: PurchaseService;
	rateLimiter: RateLimiter;
	auth: MemoryAuth;
};

// Lets the pending promises run once, so an answer that is already due is seen.
const settle = () => new Promise((resolve) => setImmediate(resolve));

// The stores, services and switches of one unit scenario, wired as the production app wires them.
function unitParts(start: Date): UnitParts {
	const time = { now: start };
	const clock: Clock = () => time.now;
	const sales: Sale[] = [];
	const redis = { down: false };
	const isDown = () => redis.down;
	const store = memoryQueueStore(clock);
	const memoryGate = memoryHoldGate(clock);
	const gate = createGuardedGate(switchable(memoryGate, isDown));
	let purchaseRepository: MemoryPurchaseRepository | undefined;
	const repository = memoryReservationRepository(
		(saleId) => purchaseRepository?.buyersOf(saleId) ?? [],
	);
	const purchased = memoryPurchaseRepository(sales, repository.rows);
	purchaseRepository = purchased;
	// Time in memory: a payment that "takes 3 seconds" waits on a timer that only the clock can fire.
	const timers: UnitParts["timers"] = [];
	const payment = createMockPayment({
		latencyMs: 0,
		failureRate: 0,
		sleep: (ms) =>
			ms <= 0
				? Promise.resolve()
				: new Promise((resolve) => {
						timers.push({ at: time.now.getTime() + ms, resolve });
					}),
	});
	const cache = { ttlMs: 0 };
	const saleService = createSaleService(fakeRepository(sales), clock, cache);
	const queue = createQueueService(
		switchable(store, isDown),
		saleService,
		clock,
		QUEUE_OPTIONS,
	);
	const reservations = createReservationService({
		gate,
		repository,
		sales: saleService,
		queue,
		clock,
		newId: randomUUID,
		options: { rebuildWaitMs: 100, wait: async () => {}, random: () => 0.5 },
	});
	const purchases = createPurchaseService(
		purchased,
		payment,
		gate,
		saleService,
		clock,
	);
	// Limits start far out of reach, so only the rate limit scenarios ever meet them.
	const limits: RateLimits = { ...LIMITS_OUT_OF_REACH };
	const rateLimiter = createRateLimiter(
		sharedCounter(switchable(createMemoryRateLimitStore(), isDown)),
		createMemoryRateLimitStore(),
		clock,
		limits,
	);
	// Logins keep their own clock, so a scenario that moves time does not end them.
	const auth = memoryAuth(() => start);
	return {
		time,
		clock,
		sales,
		redis,
		timers,
		store,
		memoryGate,
		repository,
		purchased,
		payment,
		cache,
		limits,
		saleService,
		queue,
		reservations,
		purchases,
		rateLimiter,
		auth,
	};
}

// The app over the unit parts. Streams read often in tests, so a change shows within a few milliseconds.
function unitApp(parts: UnitParts): FastifyInstance {
	return buildApp(
		{
			...healthyDeps,
			auth: parts.auth.service,
			checkGate: async () => {
				if (parts.redis.down) throw new Error("redis is down");
			},
			saleCache: parts.cache,
			sales: parts.saleService,
			queue: parts.queue,
			reservations: parts.reservations,
			purchases: parts.purchases,
			rateLimiter: parts.rateLimiter,
		},
		{
			cookieSecure: false,
			events: { ...DEFAULT_STREAM_OPTIONS, intervalMs: 20 },
		},
	);
}

// The sales, the line and the admission, as a scenario changes them. `current` returns the scenario being built, so
// an action can use the requests that are added after it.
function saleActions(parts: UnitParts, current: () => UnitQueueScenario) {
	return {
		async addSale(overrides: SaleOverrides) {
			const sale = fakeSale(overrides);
			parts.sales.push(sale);
			current().saleId = sale.id;
			return sale.id;
		},
		async setAdmitRate(perSecond: number) {
			for (const sale of parts.sales) sale.admitPerSecond = perSecond;
		},
		async setHoldSeconds(seconds: number) {
			for (const sale of parts.sales) sale.holdSeconds = seconds;
		},
		async setSold(sold: number) {
			for (const sale of parts.sales) sale.sold = sold;
		},
		async setSaleCache(ms: number) {
			parts.cache.ttlMs = ms;
		},
		// With no sale named, admit the sale the admission timer picks now, the same rule as GET /api/v1/sales/current.
		async admit(saleId?: string) {
			if (saleId === undefined) {
				await admitCurrentSale(parts.saleService, parts.queue);
			} else {
				await parts.queue.admitTick(saleId);
			}
		},
		async admitted(user: string) {
			await current().join(user);
			await parts.store.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				parts.time.now,
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async admitMany(users: string[]) {
			for (const user of users) await current().join(user);
			await parts.store.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				parts.time.now,
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async loseQueue() {
			parts.store.clear();
		},
		async loseReservationState() {
			parts.memoryGate.forget(current().saleId);
		},
		async openSale() {
			for (const sale of parts.sales) {
				sale.startsAt = new Date(parts.time.now.getTime() - MS_PER_HOUR);
			}
			await parts.queue.admitTick(current().saleId);
		},
		async sellLastItemTo(user: string) {
			const sale = parts.sales.find(
				(candidate) => candidate.id === current().saleId,
			);
			if (sale) sale.sold = sale.stock - 1;
			parts.purchased.sellTo(current().saleId, usernameOf(user));
		},
	};
}

// Time and payment: the clock moves, and the payment answers as the clock says.
function timeAndPaymentActions(
	parts: UnitParts,
	current: () => UnitQueueScenario,
) {
	return {
		async advance(seconds: number) {
			parts.time.now = new Date(
				parts.time.now.getTime() + seconds * MS_PER_SECOND,
			);
			for (const timer of parts.timers.splice(0)) {
				if (timer.at <= parts.time.now.getTime()) timer.resolve();
				else parts.timers.push(timer);
			}
			await settle();
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

// Faults and limits: the stores stop answering, the writes break, and the limits move.
function faultActions(parts: UnitParts) {
	return {
		async breakWrites() {
			parts.repository.broken = true;
		},
		async fixWrites() {
			parts.repository.broken = false;
		},
		async breakRedis() {
			parts.redis.down = true;
		},
		async fixRedis() {
			parts.redis.down = false;
		},
		async setUserLimit(requests: number, seconds: number) {
			parts.limits.perUser = requests;
			parts.limits.windowSeconds = seconds;
		},
		async setAddressLimit(requests: number, seconds: number) {
			parts.limits.perIp = requests;
			parts.limits.windowSeconds = seconds;
		},
	};
}

// One scenario in memory: sales, a queue store, a reservation gate and repository, a clock that only moves when
// the scenario says so, and the app over them.
export function queueWorld(start: Date): UnitQueueScenario {
	const parts = unitParts(start);
	const app = unitApp(parts);
	const scenario: UnitQueueScenario = {
		app,
		store: parts.store,
		gate: parts.memoryGate,
		repository: parts.repository,
		purchaseRepository: parts.purchased,
		payment: parts.payment,
		queue: parts.queue,
		reservations: parts.reservations,
		saleService: parts.saleService,
		sales: parts.sales,
		saleId: "",
		response: undefined,
		tickets: new Map(),
		holds: new Map(),
		purchases: new Map(),
		login: (user) => parts.auth.login(normalizeUser(user) ?? user),
		replies: [],
		watcher: undefined,
		...placeholders(),
		...saleActions(parts, () => scenario),
		...timeAndPaymentActions(parts, () => scenario),
		...faultActions(parts),
	};
	const requests = purchaseRequests(app, scenario);
	// Starting a confirmation in memory means waiting until it is inside the payment, before the clock moves.
	const begin = requests.startConfirm;
	requests.startConfirm = async (user) => {
		await begin(user);
		for (let turn = 0; turn < 100 && parts.timers.length === 0; turn++) {
			await settle();
		}
	};
	// Finishing a confirmation in memory means moving the clock until the payment is done.
	const finish = requests.finishConfirm;
	requests.finishConfirm = async () => {
		let done = false;
		const waiting = finish().then(() => {
			done = true;
		});
		for (let step = 0; step < 30 && !done; step++) {
			await scenario.advance(1);
		}
		await waiting;
	};
	Object.assign(
		scenario,
		queueRequests(app, scenario),
		reserveRequests(app, scenario),
		requests,
		saleRequests(app, scenario),
		eventRequests(app, scenario),
	);
	return Object.assign(scenario, limitRequests(scenario));
}

// The unit layer's ShopLayer: a fresh in-memory scenario for each call, sales timed from a fixed moment, and a hold's end
// checked exactly against that moment, so the in-memory clock is the only time there is.
export function unitShopLayer(): ShopLayer {
	const now = new Date("2026-06-01T12:00:00Z");
	return {
		now,
		newWorld: () => queueWorld(now),
		expectHoldEndsIn: (endsAt, seconds) => {
			expect(endsAt).toBe(now.getTime() + seconds * MS_PER_SECOND);
		},
	};
}
