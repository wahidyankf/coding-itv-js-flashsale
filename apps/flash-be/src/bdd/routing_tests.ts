import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { healthyDeps } from "./support/deps.js";
import { memoryAuth } from "./support/memory-auth.js";
import { specFile } from "./support/paths.js";

// vitest-cucumber runs every step as its own test, so the apps are closed when the file ends.
const apps: FastifyInstance[] = [];

afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function newApp(): FastifyInstance {
	const app = buildApp({
		...healthyDeps,
		auth: memoryAuth(() => new Date()).service,
	});
	apps.push(app);
	return app;
}

function post(app: FastifyInstance, url: string, payload: string) {
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
				response = await newApp().inject({ method: "GET", url: "/nope" });
			});

			Then("the response status is 404", () => {
				expect(response?.statusCode).toBe(404);
			});

			And("the error is {string}", (_ctx, error: string) => {
				expect(response?.json().errorCode).toBe(error);
			});
		});

		Scenario(
			"An error reply carries a sentence as well as a code",
			({ When, Then, And }) => {
				let response: LightMyRequestResponse | undefined;

				When("a client sends GET /nope", async () => {
					response = await newApp().inject({ method: "GET", url: "/nope" });
				});

				Then("the response status is 404", () => {
					expect(response?.statusCode).toBe(404);
				});

				And("the error message is {string}", (_ctx, message: string) => {
					expect(response?.json().errorMessage).toBe(message);
				});
			},
		);

		Scenario(
			"A request body that is not JSON is refused",
			({ When, Then, And }) => {
				let response: LightMyRequestResponse | undefined;

				When(
					"a client sends POST /sales/00000000-0000-4000-8000-000000000000/queue with a body that is not JSON",
					async () => {
						response = await post(
							newApp(),
							"/sales/00000000-0000-4000-8000-000000000000/queue",
							"{oops",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response?.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response?.json().errorCode).toBe(error);
				});
			},
		);

		ScenarioOutline(
			"A request body with a missing or mistyped field is refused with the code of that field",
			({ When, Then, And }, examples) => {
				let response: LightMyRequestResponse | undefined;

				When("a client sends POST <path> with the body <body>", async () => {
					response = await post(
						newApp(),
						String(examples.path),
						String(examples.body),
					);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response?.statusCode).toBe(status);
				});

				And('the error is "<error>"', () => {
					expect(response?.json().errorCode).toBe(String(examples.error));
				});
			},
		);
	},
);
