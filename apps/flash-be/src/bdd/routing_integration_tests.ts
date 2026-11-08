// Binds specs/apps/flash/be/behaviours/routing/unknown-routes.feature at the integration layer: each request goes to a new app
// over the run's real Postgres and Redis clients. The steps are in support/bind-routing.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { bindRouting, type RoutingWorld } from "./support/bind-routing.js";
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
	// The auth counter in Redis is shared by every file of the run, so the auth scenarios elsewhere fill it. The limit is
	// high so these scenarios never meet it; the limit has its own scenarios.
	const app = buildApp(
		dependenciesFrom(db, redis, { ...config, authRateLimitPerIp: 100_000 }),
		{ cookieSecure: false },
	);
	cleanups.push(() => app.close());
	return app;
}

const world: RoutingWorld = {
	get: async (url) => (await newApp()).inject({ method: "GET", url }),
	post: async (url, body) =>
		(await newApp()).inject({
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

		ScenarioOutline(
			"An old unprefixed path answers 404 not_found",
			steps.oldPath,
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
