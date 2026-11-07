// Binds specs/apps/flash/be/behaviours/health/ at the integration layer: the app over the run's real Postgres and Redis
// clients. Liveness is bound here with those clients. The readiness steps are in support/bind-health.ts, the same as at the
// unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { bindHealthReadiness } from "./support/bind-health.js";
import { openHealthIntegration } from "./support/health-integration.js";
import { specFile } from "./support/paths.js";
import type { Response } from "./support/response.js";

// vitest-cucumber runs every step as its own test, so the clients are closed once, after the whole file.
const real = openHealthIntegration();
afterAll(real.close);

const steps = bindHealthReadiness(real.newWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario(
			"Liveness reports ok without checking dependencies",
			({ When, Then, And }) => {
				const world = real.newWorld();
				let response: Response;

				When("a client sends GET /health", async () => {
					response = await world.get("/health");
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
	{ excludeTags: ["integration-exempt"] },
);
