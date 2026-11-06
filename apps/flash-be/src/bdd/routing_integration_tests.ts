import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { specFile } from "./support/paths.js";

// vitest-cucumber runs every step as its own test, so cleanup waits for the whole file.
const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function newApp(): Promise<FastifyInstance> {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	cleanups.push(
		() => db.destroy(),
		() => redis.close(),
	);
	const app = buildApp(dependenciesFrom(db, redis, config));
	cleanups.push(() => app.close());
	return app;
}

async function post(url: string, payload: string) {
	const app = await newApp();
	return app.inject({
		method: "POST",
		url,
		headers: { "content-type": "application/json" },
		payload,
	});
}

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/routing/unknown-routes.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
		Scenario("Unknown routes return 404", ({ When, Then, And }) => {
			let response: LightMyRequestResponse | undefined;

			When("a client sends GET /nope", async () => {
				const app = await newApp();
				response = await app.inject({ method: "GET", url: "/nope" });
			});

			Then("the response status is 404", () => {
				expect(response?.statusCode).toBe(404);
			});

			And("the error is {string}", (_ctx, error: string) => {
				expect(response?.json().error).toBe(error);
			});
		});

		Scenario(
			"A request body that is not JSON is refused",
			({ When, Then, And }) => {
				let response: LightMyRequestResponse | undefined;

				When(
					"a client sends POST /sales/00000000-0000-4000-8000-000000000000/queue with a body that is not JSON",
					async () => {
						response = await post(
							"/sales/00000000-0000-4000-8000-000000000000/queue",
							"{oops",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response?.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response?.json().error).toBe(error);
				});
			},
		);

		ScenarioOutline(
			"A request body with a missing or mistyped field is refused with the code of that field",
			({ When, Then, And }, examples) => {
				let response: LightMyRequestResponse | undefined;

				When("a client sends POST <path> with the body <body>", async () => {
					response = await post(String(examples.path), String(examples.body));
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response?.statusCode).toBe(status);
				});

				And('the error is "<error>"', () => {
					expect(response?.json().error).toBe(String(examples.error));
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
