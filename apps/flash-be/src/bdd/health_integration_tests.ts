import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import {
	createDb,
	type Database,
} from "../adapters/outbound/postgres/database.js";
import {
	createRedis,
	type RedisClient,
} from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { specFile } from "./support/paths.js";
import type { Response } from "./support/response.js";

// vitest-cucumber runs every step as its own test, so cleanup waits for the whole file.
const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

// A database and a Redis client that the scenario controls. Closing them is how a test makes them fail.
async function realClients(): Promise<{
	db: Kysely<Database>;
	redis: RedisClient;
}> {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	cleanups.push(
		() => db.destroy(),
		() => redis.close(),
	);
	return { db, redis };
}

async function waitUntil(
	check: () => boolean,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("condition not reached in time");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario(
			"Liveness reports ok without checking dependencies",
			({ When, Then, And }) => {
				let response: Response;

				When("a client sends GET /health", async () => {
					const { db, redis } = await realClients();
					const app = buildApp(dependenciesFrom(db, redis, config));
					cleanups.push(() => app.close());
					response = await app.inject({ method: "GET", url: "/health" });
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And('the body has status "ok"', () => {
					expect(response.json()).toEqual({ status: "ok" });
				});
			},
		);
	},
);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/readiness.feature")),
	({ Scenario }) => {
		Scenario(
			"Readiness is ok when Postgres and Redis answer",
			({ When, Then, And }) => {
				let response: Response;

				When("a client sends GET /ready", async () => {
					const { db, redis } = await realClients();
					const app = buildApp(dependenciesFrom(db, redis, config));
					cleanups.push(() => app.close());
					response = await app.inject({ method: "GET", url: "/ready" });
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And('the readiness checks report database "ok" and redis "ok"', () => {
					expect(response.json().checks).toEqual({
						database: "ok",
						redis: "ok",
					});
				});
			},
		);

		Scenario(
			"Readiness is unavailable when Postgres fails",
			({ Given, When, Then, And }) => {
				let db: Kysely<Database>;
				let response: Response;

				Given("Postgres does not answer", () => {
					// Port 1 has no listener, so every query is refused at once.
					db = createDb("postgres://flash:flash@127.0.0.1:1/flash");
					cleanups.push(() => db.destroy());
				});

				When("a client sends GET /ready", async () => {
					const { redis } = await realClients();
					const app = buildApp(dependenciesFrom(db, redis, config));
					cleanups.push(() => app.close());
					response = await app.inject({ method: "GET", url: "/ready" });
				});

				Then("the response status is 503", () => {
					expect(response.statusCode).toBe(503);
				});

				And(
					'the readiness checks report database "error" and redis "ok"',
					() => {
						expect(response.json().checks).toEqual({
							database: "error",
							redis: "ok",
						});
					},
				);
			},
		);

		Scenario(
			"Readiness is unavailable when Redis fails",
			({ Given, When, Then, And }) => {
				let redis: RedisClient;
				let response: Response;

				Given("Redis does not answer", async () => {
					redis = await createRedis(config.redisUrl);
					// Closing the client makes every later command fail.
					await redis.close();
				});

				When("a client sends GET /ready", async () => {
					const { db } = await realClients();
					const app = buildApp(dependenciesFrom(db, redis, config));
					cleanups.push(() => app.close());
					response = await app.inject({ method: "GET", url: "/ready" });
				});

				Then("the response status is 503", () => {
					expect(response.statusCode).toBe(503);
				});

				And(
					'the readiness checks report database "ok" and redis "error"',
					() => {
						expect(response.json().checks).toEqual({
							database: "ok",
							redis: "error",
						});
					},
				);
			},
		);

		Scenario(
			"Readiness recovers after Redis drops the API's connection",
			({ Given, When, And, Then }) => {
				let redis: RedisClient;
				let app: FastifyInstance;
				let response: Response;

				Given("the API is running and Redis answers", async () => {
					const clients = await realClients();
					redis = clients.redis;
					app = buildApp(dependenciesFrom(clients.db, redis, config));
					cleanups.push(() => app.close());
					expect(
						(await app.inject({ method: "GET", url: "/ready" })).statusCode,
					).toBe(200);
				});

				When("Redis drops the API's connection", async () => {
					// CLIENT KILL closes the server side of the API's socket, as a network drop would.
					const id = Number(await redis.sendCommand(["CLIENT", "ID"]));
					const admin = await createRedis(config.redisUrl);
					cleanups.push(() => admin.close());
					await admin.sendCommand(["CLIENT", "KILL", "ID", String(id)]);
				});

				And("Redis reconnects", async () => {
					// The client may take a moment to notice the dropped socket; wait for it, then for the reconnect.
					await waitUntil(() => !redis.isReady, 2000).catch(() => {});
					await waitUntil(() => redis.isReady, 5000);
				});

				And("a client sends GET /ready", async () => {
					response = await app.inject({ method: "GET", url: "/ready" });
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And('the readiness checks report database "ok" and redis "ok"', () => {
					expect(response.json().checks).toEqual({
						database: "ok",
						redis: "ok",
					});
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
