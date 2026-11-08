// The shutdown steps' integration layer: the app over the run's real Postgres and Redis on a real socket, with the mock
// payment taking real time, and the real shutdown over it. Each scenario opens its own clients, because the shutdown
// closes them as main.ts closes its own.
import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";
import type { Kysely } from "kysely";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import {
	createRedis,
	type RedisClient,
} from "../../adapters/outbound/redis/redis-client.js";
import { createRedisQueueStore } from "../../adapters/outbound/redis/redis-queue-store.js";
import { dependenciesFrom } from "../../composition.js";
import { type Config, config } from "../../config.js";
import { systemTimers } from "../../shutdown.js";
import type { StoppingWorld } from "./bind-health-shutdown.js";
import { ADMIT_EVERYONE_WAITING } from "./queue-scenario.js";
import { insertSale, loginAs } from "./seed.js";
import {
	type SaleStream,
	type StoppingServer,
	startStoppingServer,
	stoppingRequests,
	watchSale,
} from "./stopping-server.js";

// The scenario's clients. The shutdown closes them; `close` closes them when a scenario never stopped its server.
type Clients = { db: Kysely<Database>; redis: RedisClient };

// What the shopper's steps need from the scenario: its clients, its requests, its sale and its settings.
type Scene = {
	live: () => Promise<Clients>;
	requests: () => Promise<ReturnType<typeof stoppingRequests>>;
	saleId: () => string;
	settings: Config;
};

// The shopper's steps: a login, a place let in at once, a hold, and a confirmation that is still paying when the API is
// asked to stop.
function shopperSteps(scene: Scene) {
	const cookies = new Map<string, string>();
	const tickets = new Map<string, string>();
	const holds = new Map<string, string>();
	let confirmation: ReturnType<StoppingWorld["finishConfirm"]> | undefined;
	return {
		admit: async (user: string) => {
			const { db, redis } = await scene.live();
			const cookie = await loginAs(db, user);
			cookies.set(user, cookie);
			const joined = await (await scene.requests()).join(
				scene.saleId(),
				cookie,
			);
			tickets.set(user, String(joined.body.ticket));
			await createRedisQueueStore(redis).admit(
				scene.saleId(),
				ADMIT_EVERYONE_WAITING,
				new Date(),
				scene.settings.admissionTtlSeconds,
			);
		},
		reserve: async (user: string) => {
			const reply = await (await scene.requests()).reserve(
				scene.saleId(),
				cookies.get(user) ?? "",
				tickets.get(user) ?? "",
			);
			holds.set(user, String(reply.body.reservationId));
		},
		// The payment takes seconds, so the confirmation is still in flight when the next step asks the API to stop.
		startConfirm: async (user: string) => {
			confirmation = (await scene.requests()).confirm(
				scene.saleId(),
				cookies.get(user) ?? "",
				holds.get(user) ?? "",
			);
		},
		finishConfirm: async () => {
			if (!confirmation) throw new Error("no confirmation was started");
			return confirmation;
		},
	};
}

// A new shutdown scenario at the integration layer.
export function integrationStoppingWorld(): StoppingWorld {
	// Never declined and no limit in reach, so only the shutdown decides the result.
	const settings: Config = {
		...config,
		paymentLatencyMs: 0,
		paymentFailureRate: 0,
	};
	let drainMs = 0;
	let clients: Clients | undefined;
	let server: StoppingServer | undefined;
	let stream: SaleStream | undefined;
	let saleId = "";

	const live = async (): Promise<Clients> => {
		clients ??= {
			db: createDb(config.databaseUrl),
			redis: await createRedis(config.redisUrl),
		};
		return clients;
	};
	const running = async (): Promise<StoppingServer> => {
		if (server) return server;
		const { db, redis } = await live();
		server = await startStoppingServer({
			deps: dependenciesFrom(db, redis, settings),
			drainMs,
			timers: systemTimers,
			stores: [
				{ name: "Redis", close: () => redis.close() },
				{ name: "Postgres", close: () => db.destroy() },
			],
		});
		return server;
	};
	const requests = async () => stoppingRequests((await running()).origin);

	return {
		keepAnsweringFor: (seconds) => {
			drainMs = seconds * MS_PER_SECOND;
		},
		start: async () => void (await running()),
		addSale: async ({ stock, sold }) => {
			const now = Date.now();
			saleId = await insertSale((await live()).db, {
				stock,
				sold,
				startsAt: new Date(now - MS_PER_HOUR),
				endsAt: new Date(now + MS_PER_HOUR),
			});
		},
		setPaymentSeconds: (seconds) => {
			settings.paymentLatencyMs = seconds * MS_PER_SECOND;
		},
		...shopperSteps({ live, requests, saleId: () => saleId, settings }),
		watchSale: async () => {
			stream = await watchSale((await running()).origin, saleId);
		},
		askToStop: async () => (await running()).askToStop(),
		ready: async () => (await requests()).ready(),
		streamEnded: async (withinMs) => (stream ? stream.ended(withinMs) : false),
		exitCode: async (withinMs) =>
			Promise.race([
				(await running()).exited,
				new Promise<undefined>((resolve) =>
					setTimeout(() => resolve(undefined), withinMs),
				),
			]),
		close: async () => {
			stream?.close();
			if (server) await server.exited;
		},
	};
}
