// The auth steps' unit layer: the accounts and logins live in memory, two app instances are built on them (each with its
// own auth service, as two servers over one Postgres), and the clock is one the scenario moves. Only the auth steps use it; the app is closed by the test file that made it.
import { MS_PER_HOUR, MS_PER_MINUTE } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { createScryptHasher } from "../../adapters/outbound/crypto/scrypt-hasher.js";
import type { AuthService } from "../../application/auth-service.js";
import { createQueueService } from "../../application/queue-service.js";
import { createSaleService } from "../../application/sale-service.js";
import type { Sale } from "../../domain/sale.js";
import { authWorld } from "./auth-world.js";
import { healthyDeps } from "./deps.js";
import { fakeRepository, fakeSale } from "./fake-sales.js";
import { memoryAuth } from "./memory-auth.js";
import { memoryQueueStore } from "./memory-queue-store.js";
import { QUEUE_OPTIONS } from "./queue-world.js";

// Past the 15 minutes of an access token.
const PAST_ACCESS_MS = 16 * MS_PER_MINUTE;

// One scenario in memory: its accounts, logins and clock. The app goes into `apps`, so the test file can close it.
export function unitAuthWorld(apps: FastifyInstance[]) {
	let now = new Date("2026-06-01T12:00:00Z");
	const clock = () => now;
	const auth = memoryAuth(clock, createScryptHasher());
	// The sales and the queue both instances share, as they share Postgres and Redis.
	const sales: Sale[] = [];
	const saleService = createSaleService(fakeRepository(sales), clock, {
		ttlMs: 0,
	});
	const queue = createQueueService(
		memoryQueueStore(clock),
		saleService,
		clock,
		QUEUE_OPTIONS,
	);
	const instance = (service: AuthService) =>
		buildApp(
			{ ...healthyDeps, auth: service, sales: saleService, queue },
			{ cookieSecure: false },
		);
	const app = instance(auth.service);
	const second = instance(auth.anotherInstance());
	apps.push(app, second);
	return authWorld({
		app: () => app,
		secondApp: () => second,
		openSale: async () => {
			const sale = fakeSale({
				startsAt: new Date(now.getTime() - MS_PER_HOUR),
				endsAt: new Date(now.getTime() + MS_PER_HOUR),
			});
			sales.push(sale);
			return sale.id;
		},
		expireAccess: async () => {
			now = new Date(now.getTime() + PAST_ACCESS_MS);
		},
		stored: async () => auth.stored(),
		userRow: async (username) => auth.userRow(username),
	});
}
