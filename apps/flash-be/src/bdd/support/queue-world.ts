// The unit layer of a queue scenario: the app over in-memory stores, a clock that moves only when a scenario says so,
// and payment timers that fire only as that clock moves. The integration layer runs the same steps over Postgres and
// Redis (queue-integration.ts). The steps themselves are the request helpers in queue-requests.ts.

import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "../../adapters/inbound/http/event-stream.js";
import type { MockPayment } from "../../adapters/outbound/payment/mock-payment.js";
import { admitCurrentSale } from "../../application/admission.js";
import type { QueueService } from "../../application/queue-service.js";
import type { ReservationService } from "../../application/reservation-service.js";
import type { SaleService } from "../../application/sale-service.js";
import type { Sale } from "../../domain/sale.js";
import { normalizeUser } from "../../domain/user.js";
import { healthyDeps } from "./deps.js";
import { fakeSale } from "./fake-sales.js";
import { limitActions } from "./limit-actions.js";
import type { MemoryHoldGate } from "./memory-hold-gate.js";
import type { MemoryPurchaseRepository } from "./memory-purchase-repository.js";
import type { MemoryQueueStore } from "./memory-queue-store.js";
import type { MemoryReservationRepository } from "./memory-reservation-repository.js";
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
	placeholders,
	type SaleOverrides,
	type ShopScenario,
} from "./queue-scenario.js";
import type { ShopLayer } from "./shop-steps.js";
import {
	confirmOnBoth,
	giveBackNextCharge,
	setProvider,
} from "./two-instances.js";
import { byClock } from "./unit-clock.js";
import { type UnitParts, unitParts } from "./unit-parts.js";
import { usernameOf } from "./users.js";

// The types a queue scenario is built from, re-exported so the unit layer's test file imports them from one place.
export type {
	EventWatcher,
	QueueScenario,
	Response,
	ShopScenario,
} from "./queue-scenario.js";

// One queue scenario at the unit layer: the app and each in-memory store, so a step can set or read any of them.
export type UnitQueueScenario = ShopScenario & {
	app: FastifyInstance;
	store: MemoryQueueStore;
	gate: MemoryHoldGate;
	repository: MemoryReservationRepository;
	// The purchase rows and the payment, so a test can make a commit fail and read the refunds.
	purchaseRepository: MemoryPurchaseRepository;
	payment: MockPayment;
	queue: QueueService;
	reservations: ReservationService;
	saleService: SaleService;
	sales: Sale[];
};

// Lets the pending promises run once, so an answer that is already due is seen.
const settle = () => new Promise((resolve) => setImmediate(resolve));

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
		async setAdmissionSeconds(seconds: number) {
			parts.queueOptions.admissionTtlSeconds = seconds;
		},
		async setHoldSeconds(seconds: number) {
			for (const sale of parts.sales) sale.holdSeconds = seconds;
		},
		async setSold(sold: number) {
			for (const sale of parts.sales) sale.sold = sold;
		},
		async endSale() {
			for (const sale of parts.sales) {
				if (sale.id === current().saleId) {
					sale.endsAt = new Date(parts.time.now.getTime() - MS_PER_SECOND);
				}
			}
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
				parts.queueOptions.admissionTtlSeconds,
			);
		},
		async admitMany(users: string[]) {
			for (const user of users) await current().join(user);
			await parts.store.admit(
				current().saleId,
				ADMIT_EVERYONE_WAITING,
				parts.time.now,
				parts.queueOptions.admissionTtlSeconds,
			);
		},
		async loseQueue() {
			parts.store.clear();
		},
		async loseReservationState() {
			parts.memoryGate.forget(current().saleId);
		},
		async holdRebuildLock() {
			await parts.memoryGate.lockRebuild(
				current().saleId,
				MS_PER_HOUR,
				"another-instance",
			);
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

// Faults: the stores stop answering and the writes break. The limits are in limit-actions.ts.
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
	};
}

// One scenario in memory: sales, a queue store, a reservation gate and repository, a clock that only moves when
// the scenario says so, and the app over them.
export function queueWorld(start: Date): UnitQueueScenario {
	const parts = unitParts(start);
	const app = unitApp(parts);
	let secondApp: FastifyInstance | undefined;
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
		...limitActions(parts.limits),
		holdRows: async () =>
			parts.repository.holdRows(scenario.saleId, parts.time.now),
		confirmOnTwoInstances: async (user) => {
			secondApp ??= unitApp({ ...parts, purchases: parts.secondPurchases });
			return byClock(confirmOnBoth([app, secondApp], scenario, user), scenario);
		},
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
		await byClock(finish(), scenario);
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
