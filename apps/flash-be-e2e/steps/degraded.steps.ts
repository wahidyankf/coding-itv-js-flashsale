// Steps for the API when Postgres or Redis does not answer, and when they come back (with the data they had, or with none).
// Binds degraded/serving.feature and health/readiness.feature. Postgres is pointed at an address nobody listens on, and
// Redis is cut at the proxy, which leaves the data in Redis as it was.

import { PROBE_PATHS } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { E2E_REDIS_URL, startApi, withRedis } from "./support/processes.js";
import { pollUntil } from "./support/time.js";
import { setApiEnv, world } from "./support/world.js";

const { Given } = createBdd();

// /ready answers 503 while the API cannot reach Redis and 200 once it can. Waiting for it makes the step exact.
async function waitForReady(url: string, ready: boolean): Promise<void> {
	await pollUntil(
		async () =>
			((await fetch(`${url}${PROBE_PATHS.ready}`)).status === 200) === ready,
		{
			withinMs: 15_000,
			everyMs: 50,
			failure: `the API did not become ${ready ? "ready" : "not ready"}`,
		},
	);
}

function proxy() {
	if (!world.redisProxy) throw new Error("the API was not started");
	return world.redisProxy;
}

// The address has no listener, so every connection is refused at once, as with a Postgres that is down.
const DEAD_POSTGRES = "postgres://flash:flash@127.0.0.1:1/flash";

Given("Postgres does not answer", async ({ request: _request }) => {
	setApiEnv({ DATABASE_URL: DEAD_POSTGRES });
	await startApi();
});

Given("Redis does not answer", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().down();
	await waitForReady(url, false);
});

Given("Redis is down", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().down();
	await waitForReady(url, false);
});

Given("Redis is back with the data it had", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().up();
	await waitForReady(url, true);
});

Given("Redis is back with no data", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().up();
	await waitForReady(url, true);
	await withRedis(E2E_REDIS_URL, (redis) => redis.flushDb());
	expect(world.redisProxy).toBeDefined();
});
