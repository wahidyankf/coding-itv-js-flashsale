import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { buildApp, dependenciesFrom } from "../app.js";
import { config } from "../config.js";
import { createDb } from "../db.js";
import { createRedis } from "../redis.js";
import { specFile } from "./support/paths.js";

// vitest-cucumber runs every step as its own test, so cleanup waits for the whole file.
const cleanups: Array<() => Promise<unknown>> = [];

afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/routing/unknown-routes.feature"),
	),
	({ Scenario }) => {
		Scenario("Unknown routes return 404", ({ When, Then }) => {
			let status = 0;

			When("a client sends GET /nope", async () => {
				const db = createDb(config.databaseUrl);
				const redis = await createRedis(config.redisUrl);
				cleanups.push(
					() => db.destroy(),
					() => redis.close(),
				);
				const app = buildApp(dependenciesFrom(db, redis));
				cleanups.push(() => app.close());
				status = (await app.inject({ method: "GET", url: "/nope" })).statusCode;
			});

			Then("the response status is 404", () => {
				expect(status).toBe(404);
			});
		});
	},
	{ excludeTags: ["integration-exempt"] },
);
