import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { Clock } from "../../clock.js";
import { createQueueService } from "../../queue/queue-service.js";
import type { Sale } from "../../sales/sale.js";
import { createSaleService } from "../../sales/sale-service.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository, fakeSale } from "./fake-sales.js";
import {
	type MemoryQueueStore,
	memoryQueueStore,
} from "./memory-queue-store.js";

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

export type UnitQueueScenario = QueueScenario & {
	app: FastifyInstance;
	store: MemoryQueueStore;
	queue: ReturnType<typeof createQueueService>;
	sales: Sale[];
};

// One scenario's queue in memory: a list of sales, an in-memory queue store and the app over them.
export function queueWorld(clock: Clock): UnitQueueScenario {
	const sales: Sale[] = [];
	const store = memoryQueueStore(clock);
	const saleService = createSaleService(fakeRepository(sales), clock);
	const queue = createQueueService(store, saleService, clock, QUEUE_OPTIONS);
	const app = buildApp({ ...healthyDeps, sales: saleService, queue });
	const scenario: UnitQueueScenario = {
		app,
		store,
		queue,
		sales,
		saleId: "",
		response: undefined,
		tickets: new Map(),
		async addSale(overrides) {
			const sale = fakeSale(overrides);
			sales.push(sale);
			scenario.saleId = sale.id;
			return sale.id;
		},
		async setAdmitRate(perSecond) {
			for (const sale of sales) sale.admitPerSecond = perSecond;
		},
		join: async () => {
			throw new Error("replaced below");
		},
		check: async () => {
			throw new Error("replaced below");
		},
		async admit(saleId = scenario.saleId) {
			await queue.admitTick(saleId);
		},
		async loseQueue() {
			store.clear();
		},
	};
	return Object.assign(scenario, queueRequests(app, scenario));
}
