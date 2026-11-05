import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../app.js";
import { healthyDeps } from "./support/deps.js";
import { specFile } from "./support/paths.js";

// vitest-cucumber runs every step as its own test, so the apps are closed when the file ends.
const apps: FastifyInstance[] = [];

afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/routing/unknown-routes.feature"),
	),
	({ Scenario }) => {
		Scenario("Unknown routes return 404", ({ When, Then }) => {
			let status = 0;

			When("a client sends GET /nope", async () => {
				const app = buildApp(healthyDeps);
				apps.push(app);
				status = (await app.inject({ method: "GET", url: "/nope" })).statusCode;
			});

			Then("the response status is 404", () => {
				expect(status).toBe(404);
			});
		});
	},
);
