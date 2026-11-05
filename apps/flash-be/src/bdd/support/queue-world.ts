import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { Clock } from "../../clock.js";
import { createQueueService } from "../../queue/queue-service.js";
import { createReservationService } from "../../reservations/reservation-service.js";
import type { Sale } from "../../sales/sale.js";
import { createSaleService } from "../../sales/sale-service.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository, fakeSale } from "./fake-sales.js";
import { type MemoryHoldGate, memoryHoldGate } from "./memory-hold-gate.js";
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
	const repository = memoryReservationRepository();
	const saleService = createSaleService(fakeRepository(sales), clock);
	const queue = createQueueService(store, saleService, clock, QUEUE_OPTIONS);
	const reservations = createReservationService(
		gate,
		repository,
		saleService,
		queue,
		clock,
		{ rebuildWaitMs: 100, wait: async () => {} },
	);
	const app = buildApp({
		...healthyDeps,
		sales: saleService,
		queue,
		reservations,
	});
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
	};
	return Object.assign(
		scenario,
		queueRequests(app, scenario),
		reserveRequests(app, scenario),
	);
}

function notWired(): never {
	throw new Error("replaced when the scenario is built");
}
