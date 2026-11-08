// The health steps' integration layer: the app over real Postgres and Redis clients. A scenario that stops one of them
// swaps in a client that cannot answer, and a dropped connection is a CLIENT KILL on the server.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { expect } from "vitest";
import { buildApp } from "../../adapters/inbound/http/app.js";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import {
	createRedis,
	type RedisClient,
} from "../../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../../composition.js";
import { config } from "../../config.js";
import type { HealthWorld } from "./bind-health.js";
import { waitFor } from "./wait.js";

// How long the app may take to notice a dropped socket, and to reconnect to Redis, in milliseconds.
const NOTICE_MS = 2000;
const RECONNECT_MS = 5000;

// The clients one scenario's app is built on. A step that stops one of them swaps it here.
type Clients = { db: Kysely<Database>; redis: RedisClient };

// Opens the world of each health scenario, and a `close` that ends every client and app the scenarios opened.
export function openHealthIntegration(): {
	newWorld: () => HealthWorld;
	close: () => Promise<void>;
} {
	const cleanups: Array<() => Promise<unknown>> = [];

	// Opens the database and Redis clients the app uses. Both are closed when the run ends.
	const openClients = async (): Promise<Clients> => {
		const db = createDb(config.databaseUrl);
		const redis = await createRedis(config.redisUrl);
		cleanups.push(
			() => db.destroy(),
			() => redis.close(),
		);
		return { db, redis };
	};

	const newWorld = (): HealthWorld => {
		let clients: Promise<Clients> | undefined;
		const live = (): Promise<Clients> => {
			clients ??= openClients();
			return clients;
		};
		// An app over the scenario's clients at the time of the call, so a step that swapped a client takes effect.
		const appWith = async (): Promise<FastifyInstance> => {
			const { db, redis } = await live();
			const app = buildApp(dependenciesFrom(db, redis, config), {
				cookieSecure: false,
			});
			cleanups.push(() => app.close());
			return app;
		};
		return {
			breakDatabase: async () => {
				// Port 1 has no listener, so every query is refused at once.
				const unreachable = createDb(
					"postgres://flash:flash@127.0.0.1:1/flash",
				);
				cleanups.push(() => unreachable.destroy());
				const { redis } = await live();
				clients = Promise.resolve({ db: unreachable, redis });
			},
			breakRedis: async () => {
				const { db } = await live();
				const redis = await createRedis(config.redisUrl);
				// Closing the client makes every later command fail.
				await redis.close();
				clients = Promise.resolve({ db, redis });
			},
			startApi: async () => {
				const app = await appWith();
				const ready = await app.inject({ method: "GET", url: "/ready" });
				expect(ready.statusCode).toBe(200);
			},
			dropRedisConnection: async () => {
				// CLIENT KILL closes the server side of the API's socket, as a network drop would.
				const { redis } = await live();
				const id = Number(await redis.sendCommand(["CLIENT", "ID"]));
				const admin = await createRedis(config.redisUrl);
				cleanups.push(() => admin.close());
				await admin.sendCommand(["CLIENT", "KILL", "ID", String(id)]);
			},
			redisReconnects: async () => {
				// The client may take a moment to notice the dropped socket, then it reconnects on its own.
				const { redis } = await live();
				await waitFor(() => !redis.isReady, NOTICE_MS);
				if (!(await waitFor(() => redis.isReady, RECONNECT_MS))) {
					throw new Error("condition not reached in time");
				}
			},
			get: async (url) => {
				const app = await appWith();
				return app.inject({ method: "GET", url });
			},
		};
	};

	return {
		newWorld,
		async close() {
			await Promise.all(cleanups.splice(0).map((close) => close()));
		},
	};
}
