import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterEach, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import type { Dependencies } from "../application/dependencies.js";
import { healthyDeps } from "./support/deps.js";
import { specFile } from "./support/paths.js";

type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

const apps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(deps: Dependencies): FastifyInstance {
	const app = buildApp(deps);
	apps.push(app);
	return app;
}

const failing = async () => {
	throw new Error("unavailable");
};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario(
			"Liveness reports ok without checking dependencies",
			({ When, Then, And }) => {
				let response: Response;

				When("a client sends GET /health", async () => {
					const app = appWith({
						...healthyDeps,
						checkDatabase: failing,
						checkRedis: failing,
					});
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
					response = await appWith(healthyDeps).inject({
						method: "GET",
						url: "/ready",
					});
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
				let deps: Dependencies = healthyDeps;
				let response: Response;

				Given("Postgres does not answer", () => {
					deps = { ...healthyDeps, checkDatabase: failing };
				});

				When("a client sends GET /ready", async () => {
					response = await appWith(deps).inject({
						method: "GET",
						url: "/ready",
					});
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
				let deps: Dependencies = healthyDeps;
				let response: Response;

				Given("Redis does not answer", () => {
					deps = { ...healthyDeps, checkRedis: failing };
				});

				When("a client sends GET /ready", async () => {
					response = await appWith(deps).inject({
						method: "GET",
						url: "/ready",
					});
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
				// A unit test cannot cut a real socket, so the drop is a flag that the fake Redis check reads.
				let redisUp = true;
				let response: Response;

				Given("the API is running and Redis answers", () => {
					redisUp = true;
				});

				When("Redis drops the API's connection", () => {
					redisUp = false;
				});

				And("Redis reconnects", () => {
					redisUp = true;
				});

				And("a client sends GET /ready", async () => {
					const checkRedis = async () => {
						if (!redisUp) throw new Error("connection dropped");
					};
					response = await appWith({ ...healthyDeps, checkRedis }).inject({
						method: "GET",
						url: "/ready",
					});
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
);
