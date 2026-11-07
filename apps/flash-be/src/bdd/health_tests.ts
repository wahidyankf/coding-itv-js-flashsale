// Binds specs/apps/flash/be/behaviours/health/ at the unit layer: each dependency is a switch the scenario flips, and the app
// is built on those switches. Liveness is bound here, with both dependencies down, because only this layer has them down
// without a socket. The readiness steps are in support/bind-health.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { bindHealthReadiness } from "./support/bind-health.js";
import { healthyDeps } from "./support/deps.js";
import { unitHealthWorld } from "./support/health-unit.js";
import { specFile } from "./support/paths.js";
import type { Response } from "./support/response.js";

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const failing = async () => {
	throw new Error("unavailable");
};

const steps = bindHealthReadiness(() => unitHealthWorld(apps));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario(
			"Liveness reports ok without checking dependencies",
			({ When, Then, And }) => {
				let response: Response;

				When("a client sends GET /health", async () => {
					const app = buildApp(
						{ ...healthyDeps, checkDatabase: failing, checkGate: failing },
						{ cookieSecure: false },
					);
					apps.push(app);
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
		Scenario("Readiness is ok when Postgres and Redis answer", steps.readyOk);

		Scenario(
			"Readiness is unavailable when Postgres fails",
			steps.postgresFails,
		);

		Scenario("Readiness is unavailable when Redis fails", steps.redisFails);

		Scenario(
			"Readiness recovers after Redis drops the API's connection",
			steps.recoversAfterDrop,
		);
	},
);
