// Binds specs/apps/flash/be/behaviours/routing/unknown-routes.feature at the unit layer: each request goes to a new app with
// in-memory login and every other dependency healthy. The steps are in support/bind-routing.ts, the same as at the
// integration layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { bindRouting, type RoutingWorld } from "./support/bind-routing.js";
import { healthyDeps } from "./support/deps.js";
import { memoryAuth } from "./support/memory-auth.js";
import { specFile } from "./support/paths.js";

// vitest-cucumber runs every step as its own test, so the apps are closed when the file ends.
const apps: FastifyInstance[] = [];

afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function newApp(): FastifyInstance {
	const app = buildApp(
		{ ...healthyDeps, auth: memoryAuth(() => new Date()).service },
		{ cookieSecure: false },
	);
	apps.push(app);
	return app;
}

const world: RoutingWorld = {
	get: (url) => newApp().inject({ method: "GET", url }),
	post: (url, body) =>
		newApp().inject({
			method: "POST",
			url,
			headers: { "content-type": "application/json" },
			payload: body,
		}),
};

const steps = bindRouting(() => world);

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/routing/unknown-routes.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
		Scenario("Unknown routes return 404", steps.unknownRoute);

		Scenario(
			"An error reply carries a sentence as well as a code",
			steps.errorSentence,
		);

		Scenario("A request body that is not JSON is refused", steps.notJson);

		ScenarioOutline(
			"A request body with a missing or mistyped field is refused with the code of that field",
			steps.badField,
		);
	},
);
