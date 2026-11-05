import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { Route } from "../routes/api/health";
import { specFile } from "./support/paths";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario("Web liveness returns ok", ({ When, Then, And }) => {
			let response: Response;

			When("a client sends GET /api/health", async () => {
				const handlers = Route.options.server?.handlers as {
					GET: () => Response | Promise<Response>;
				};
				response = await handlers.GET();
			});

			Then("the response status is 200", () => {
				expect(response.status).toBe(200);
			});

			And('the body has status "ok"', async () => {
				expect(await response.json()).toEqual({ status: "ok" });
			});
		});
	},
);
