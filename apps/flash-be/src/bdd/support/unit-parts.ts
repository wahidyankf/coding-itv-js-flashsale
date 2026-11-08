// The unit layer's wiring: the in-memory stores, services and switches of one queue scenario, wired as the production app
// wires them. queue-world.ts holds the steps over them, and this file holds the setup, so each file stays under the
// line limit.

import { randomUUID } from "node:crypto";
import { createMemoryRateLimitStore } from "../../adapters/outbound/memory/memory-rate-limit-store.js";
import type { MockPayment } from "../../adapters/outbound/payment/mock-payment.js";
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
import { fakeRepository } from "./fake-sales.js";
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
import { LIMITS_OUT_OF_REACH } from "./queue-scenario.js";
import { sharedCounter } from "./shared-counter.js";
import { switchable } from "./switchable.js";
import { unitPayments } from "./two-instances.js";

// The queue settings the unit layer runs with. The tick and the admission take the configuration defaults, so the unit
// layer and a server agree on them; only the ticket secret is set here.
const queueDefaults = buildConfig({});
// The queue settings of the unit layer: a fixed ticket secret, and the server's own tick and admission lifetime.
export const QUEUE_OPTIONS = {
	ticketSecret: "unit-secret",
	admissionTickMs: queueDefaults.admissionTickMs,
	admissionTtlSeconds: queueDefaults.admissionTtlSeconds,
};

// Everything one unit scenario is built from. The actions below read and change these, and the app is built over them.
export type UnitParts = {
	time: { now: Date };
	clock: Clock;
	sales: Sale[];
	redis: { down: boolean };
	timers: Array<{ at: number; resolve: () => void }>;
	store: MemoryQueueStore;
	memoryGate: MemoryHoldGate;
	repository: MemoryReservationRepository;
	purchased: MemoryPurchaseRepository;
	payment: MockPayment;
	cache: { ttlMs: number };
	limits: RateLimits;
	// This scenario's copy of the queue settings, so a scenario that shortens the admission changes only its own.
	queueOptions: typeof QUEUE_OPTIONS;
	saleService: SaleService;
	queue: QueueService;
	reservations: ReservationService;
	purchases: PurchaseService;
	secondPurchases: PurchaseService;
	// The payments of both instances, which a provider setting changes together.
	payments: MockPayment[];
	rateLimiter: RateLimiter;
	auth: MemoryAuth;
};

// The stores, services and switches of one unit scenario, wired as the production app wires them.
export function unitParts(start: Date): UnitParts {
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
	const [payment, secondPayment] = unitPayments(clock, timers, purchased);
	const cache = { ttlMs: 0 };
	const saleService = createSaleService(fakeRepository(sales), clock, cache);
	const queueOptions = { ...QUEUE_OPTIONS };
	const queue = createQueueService(
		switchable(store, isDown),
		saleService,
		clock,
		queueOptions,
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
	// A second instance of the API has its own payment, over the same ledger and the same stores.
	const purchasesOver = (pay: MockPayment) =>
		createPurchaseService(purchased, pay, gate, saleService, clock);
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
		queueOptions,
		saleService,
		queue,
		reservations,
		purchases: purchasesOver(payment),
		secondPurchases: purchasesOver(secondPayment),
		payments: [payment, secondPayment],
		rateLimiter,
		auth,
	};
}
