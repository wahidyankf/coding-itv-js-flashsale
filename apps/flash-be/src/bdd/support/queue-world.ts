import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { Clock } from "../../clock.js";
import { createMockPayment } from "../../payment/mock-payment.js";
import { createPurchaseService } from "../../purchases/purchase-service.js";
import { createQueueService } from "../../queue/queue-service.js";
import { createMemoryRateLimitStore } from "../../ratelimit/memory-rate-limit-store.js";
import { createRateLimiter } from "../../ratelimit/rate-limiter.js";
import { createReservationService } from "../../reservations/reservation-service.js";
import type { Sale } from "../../sales/sale.js";
import { createSaleService } from "../../sales/sale-service.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository, fakeSale } from "./fake-sales.js";
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

export type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

// What a queue scenario does, whatever the layer. Unit tests answer it in memory; integration tests use
// Postgres and Redis.
export type QueueScenario = {
	saleId: string;
	response: Response | undefined;
	tickets: Map<string, string>;
	addSale: (overrides: Partial<Sale>) => Promise<string>;
	setAdmitRate: (perSecond: number) => Promise<void>;
	join: (user: string, saleId?: string) => Promise<Response>;
	check: (user: string, ticket?: string) => Promise<Response>;
	admit: (saleId?: string) => Promise<void>;
	loseQueue: () => Promise<void>;
};

// The same, for reserving. A scenario that reserves also joins and admits shoppers, so it extends the queue scenario.
export type ShopScenario = QueueScenario & {
	holds: Map<string, { reservationId: string; expiresAt: string }>;
	setHoldSeconds: (seconds: number) => Promise<void>;
	// Joins the queue and gets admitted at once, without waiting for the timer.
	admitted: (user: string) => Promise<void>;
	admitMany: (users: string[]) => Promise<void>;
	reserve: (
		user: string,
		options?: { ticket?: string; saleId?: string },
	) => Promise<Response>;
	reserveAll: (users: string[]) => Promise<Response[]>;
	// Time passes: the unit clock moves; other layers really wait.
	advance: (seconds: number) => Promise<void>;
	loseReservationState: () => Promise<void>;
	breakWrites: () => Promise<void>;
	fixWrites: () => Promise<void>;
	purchases: Map<string, { purchaseId: string }>;
	confirm: (
		user: string,
		options?: { reservationId?: string; saleId?: string; owner?: string },
	) => Promise<Response>;
	// Confirms without waiting for the answer; `finishConfirm` waits for it.
	startConfirm: (user: string) => Promise<void>;
	finishConfirm: () => Promise<void>;
	confirmAllHolders: (users: string[]) => Promise<Response[]>;
	outcome: (user: string, saleId?: string) => Promise<Response>;
	saleView: () => Promise<{ status: string; remaining: number }>;
	setPaymentDeclines: () => Promise<void>;
	setPaymentDuration: (seconds: number) => Promise<void>;
	// Another instance sells the last item to this user, behind the back of the scenario.
	sellLastItemTo: (user: string) => Promise<void>;
	wasRefunded: (user: string) => Promise<boolean>;
	// The sale read cache: its time, a change behind its back, and the public reads.
	setSaleCache: (ms: number) => Promise<void>;
	setSold: (sold: number) => Promise<void>;
	readSale: () => Promise<Response>;
	readCurrentSale: () => Promise<Response>;
	setUserLimit: (requests: number, seconds: number) => Promise<void>;
	setAddressLimit: (requests: number, seconds: number) => Promise<void>;
	// Sends the same kind of write request several times, one after the other.
	repeat: (kind: string, user: string, times: number) => Promise<Response[]>;
	joinMany: (count: number) => Promise<Response[]>;
	replies: Response[];
};

export const QUEUE_OPTIONS = {
	ticketSecret: "unit-secret",
	admissionTickMs: 1000,
	admissionTtlSeconds: 600,
};

// The requests every layer sends the same way. `saleId` is read when the request is sent.
export function queueRequests(app: FastifyInstance, scenario: QueueScenario) {
	return {
		async join(user: string, saleId = scenario.saleId): Promise<Response> {
			const reply = await app.inject({
				method: "POST",
				url: `/sales/${saleId}/queue`,
				payload: { userId: user },
			});
			scenario.response = reply;
			const ticket = reply.json().ticket;
			const key = user.trim().toLowerCase();
			if (ticket && !scenario.tickets.has(key)) {
				scenario.tickets.set(key, ticket);
			}
			return reply;
		},
		async check(user: string, ticket?: string): Promise<Response> {
			scenario.response = await app.inject({
				method: "GET",
				url: `/sales/${scenario.saleId}/queue/${user}`,
				headers: ticket === undefined ? {} : { "x-queue-ticket": ticket },
			});
			return scenario.response;
		},
	};
}

// The reserve request, the same at every layer.
export function reserveRequests(app: FastifyInstance, scenario: ShopScenario) {
	const send = async (
		user: string,
		options: { ticket?: string; saleId?: string } = {},
	): Promise<Response> => {
		const key = user.trim().toLowerCase();
		const ticket = options.ticket ?? scenario.tickets.get(key);
		const reply = await app.inject({
			method: "POST",
			url: `/sales/${options.saleId ?? scenario.saleId}/reservations`,
			payload: { userId: user },
			headers: ticket === undefined ? {} : { "x-queue-ticket": ticket },
		});
		scenario.response = reply;
		if (
			(reply.statusCode === 201 || reply.statusCode === 200) &&
			!scenario.holds.has(key)
		) {
			scenario.holds.set(key, reply.json());
		}
		return reply;
	};
	return {
		reserve: send,
		reserveAll: (users: string[]) =>
			Promise.all(users.map((user) => send(user))),
	};
}

// The purchase requests, the same at every layer.
export function purchaseRequests(app: FastifyInstance, scenario: ShopScenario) {
	let pending: Promise<Response> | undefined;
	const send = async (
		user: string,
		options: { reservationId?: string; saleId?: string; owner?: string } = {},
	): Promise<Response> => {
		const key = user.trim().toLowerCase();
		const owner = (options.owner ?? user).trim().toLowerCase();
		const reservationId =
			options.reservationId ?? scenario.holds.get(owner)?.reservationId;
		const reply = await app.inject({
			method: "POST",
			url: `/sales/${options.saleId ?? scenario.saleId}/purchases`,
			payload: { userId: user, reservationId },
		});
		scenario.response = reply;
		if (
			(reply.statusCode === 201 || reply.statusCode === 200) &&
			!scenario.purchases.has(key)
		) {
			scenario.purchases.set(key, reply.json());
		}
		return reply;
	};
	return {
		confirm: send,
		async startConfirm(user: string) {
			pending = send(user);
		},
		async finishConfirm() {
			if (!pending) throw new Error("no confirmation was started");
			scenario.response = await pending;
		},
		confirmAllHolders: (users: string[]) =>
			Promise.all(
				users
					.filter((user) => scenario.holds.has(user))
					.map((user) => send(user)),
			),
		async outcome(user: string, saleId = scenario.saleId) {
			scenario.response = await app.inject({
				method: "GET",
				url: `/sales/${saleId}/purchases/${encodeURIComponent(user)}`,
			});
			return scenario.response;
		},
		async saleView() {
			const reply = await app.inject({
				method: "GET",
				url: `/sales/${scenario.saleId}`,
			});
			return reply.json();
		},
	};
}

// The public sale reads, the same at every layer.
export function saleRequests(app: FastifyInstance, scenario: ShopScenario) {
	return {
		async readSale() {
			scenario.response = await app.inject({
				method: "GET",
				url: `/sales/${scenario.saleId}`,
			});
			return scenario.response;
		},
		async readCurrentSale() {
			scenario.response = await app.inject({
				method: "GET",
				url: "/sales/current",
			});
			return scenario.response;
		},
	};
}

// Write requests by the name a scenario uses for them, for the rate limit scenarios.
export function limitRequests(scenario: ShopScenario) {
	const send = async (kind: string, user: string): Promise<Response> => {
		if (kind === "join the queue") return scenario.join(user);
		if (kind === "reserve an item") return scenario.reserve(user);
		if (kind === "confirm a purchase") {
			return scenario.confirm(user, { reservationId: "not-an-id" });
		}
		throw new Error(`unknown request "${kind}"`);
	};
	return {
		async repeat(kind: string, user: string, times: number) {
			scenario.replies = [];
			for (let attempt = 0; attempt < times; attempt++) {
				scenario.replies.push(await send(kind, user));
			}
			return scenario.replies;
		},
		async joinMany(count: number) {
			scenario.replies = [];
			for (let index = 0; index < count; index++) {
				scenario.replies.push(await scenario.join(`visitor${index}`));
			}
			return scenario.replies;
		},
	};
}

export type UnitQueueScenario = ShopScenario & {
	app: FastifyInstance;
	store: MemoryQueueStore;
	gate: MemoryHoldGate;
	repository: MemoryReservationRepository;
	queue: ReturnType<typeof createQueueService>;
	reservations: ReturnType<typeof createReservationService>;
	saleService: ReturnType<typeof createSaleService>;
	sales: Sale[];
};

// One scenario in memory: sales, a queue store, a reservation gate and repository, a clock that only moves when
// the scenario says so, and the app over them.
export function queueWorld(start: Date): UnitQueueScenario {
	let now = start;
	const clock: Clock = () => now;
	const sales: Sale[] = [];
	const store = memoryQueueStore(clock);
	const gate = memoryHoldGate(clock);
	let purchaseRepository: MemoryPurchaseRepository | undefined;
	const repository = memoryReservationRepository(
		(saleId) => purchaseRepository?.buyersOf(saleId) ?? [],
	);
	const purchased = memoryPurchaseRepository(sales, repository.rows);
	purchaseRepository = purchased;
	// Time in memory: a payment that "takes 3 seconds" waits on a timer that only `advance` can fire.
	const timers: Array<{ at: number; resolve: () => void }> = [];
	const payment = createMockPayment({
		latencyMs: 0,
		failureRate: 0,
		sleep: (ms) =>
			ms <= 0
				? Promise.resolve()
				: new Promise((resolve) => {
						timers.push({ at: now.getTime() + ms, resolve });
					}),
	});
	const cache = { ttlMs: 0 };
	const saleService = createSaleService(fakeRepository(sales), clock, cache);
	const queue = createQueueService(store, saleService, clock, QUEUE_OPTIONS);
	const reservations = createReservationService(
		gate,
		repository,
		saleService,
		queue,
		clock,
		{ rebuildWaitMs: 100, wait: async () => {} },
	);
	const purchases = createPurchaseService(
		purchased,
		payment,
		gate,
		saleService,
		clock,
	);
	// Limits start far out of reach, so only the rate limit scenarios ever meet them.
	const limits = { windowSeconds: 60, perUser: 100_000, perIp: 100_000 };
	const rateLimiter = createRateLimiter(
		createMemoryRateLimitStore(),
		createMemoryRateLimitStore(),
		clock,
		limits,
	);
	const app = buildApp({
		...healthyDeps,
		sales: saleService,
		queue,
		reservations,
		purchases,
		rateLimiter,
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	const scenario: UnitQueueScenario = {
		app,
		store,
		gate,
		repository,
		queue,
		reservations,
		saleService,
		sales,
		saleId: "",
		response: undefined,
		tickets: new Map(),
		holds: new Map(),
		purchases: new Map(),
		async addSale(overrides) {
			const sale = fakeSale(overrides);
			sales.push(sale);
			scenario.saleId = sale.id;
			return sale.id;
		},
		async setAdmitRate(perSecond) {
			for (const sale of sales) sale.admitPerSecond = perSecond;
		},
		async setHoldSeconds(seconds) {
			for (const sale of sales) sale.reservationTtlSeconds = seconds;
		},
		join: notWired,
		check: notWired,
		reserve: notWired,
		reserveAll: notWired,
		async admit(saleId = scenario.saleId) {
			await queue.admitTick(saleId);
		},
		async admitted(user) {
			await scenario.join(user);
			await store.admit(
				scenario.saleId,
				1000,
				now,
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async admitMany(users) {
			for (const user of users) await scenario.join(user);
			await store.admit(
				scenario.saleId,
				1000,
				now,
				QUEUE_OPTIONS.admissionTtlSeconds,
			);
		},
		async advance(seconds) {
			now = new Date(now.getTime() + seconds * 1000);
			for (const timer of timers.splice(0)) {
				if (timer.at <= now.getTime()) timer.resolve();
				else timers.push(timer);
			}
			await settle();
		},
		async loseQueue() {
			store.clear();
		},
		async loseReservationState() {
			gate.forget(scenario.saleId);
		},
		async breakWrites() {
			repository.broken = true;
		},
		async fixWrites() {
			repository.broken = false;
		},
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
		async setSaleCache(ms) {
			cache.ttlMs = ms;
		},
		async setSold(sold) {
			for (const sale of sales) sale.sold = sold;
		},
		readSale: notWired,
		readCurrentSale: notWired,
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
			const sale = sales.find((candidate) => candidate.id === scenario.saleId);
			if (sale) sale.sold = sale.stock - 1;
			purchased.sellTo(scenario.saleId, user);
		},
		async wasRefunded(user) {
			const id = scenario.holds.get(user)?.reservationId;
			return payment.refunded.includes(`mock-${id}`);
		},
	};
	const requests = purchaseRequests(app, scenario);
	// Starting a confirmation in memory means waiting until it is inside the payment, before the clock moves.
	const begin = requests.startConfirm;
	requests.startConfirm = async (user) => {
		await begin(user);
		for (let turn = 0; turn < 100 && timers.length === 0; turn++) {
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
	);
	return Object.assign(scenario, limitRequests(scenario));
}

function notWired(): never {
	throw new Error("replaced when the scenario is built");
}
