// Steps for the shutdown of the API: its drain window, the stop signal sent to its real process, the readiness reply while
// it stops, and its exit code. Binds health/shutdown.feature. The request, reply, purchase and stream steps it also uses
// are in be.steps.ts, purchase.steps.ts and events.steps.ts.
import { MS_PER_SECOND } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { startApi } from "./support/processes.js";
import { currentResponse } from "./support/response.js";
import { pollUntil } from "./support/time.js";
import { setApiEnv, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The line the API logs once it has the signal, and has turned readiness to 503.
const STOPPING_LINE = "SIGTERM received: stopping";

// The private API, started when no step has started it yet.
async function runningApi() {
	await startApi();
	if (!world.api) throw new Error("the API did not start");
	return world.api;
}

Given(
	/^the API keeps answering for (\d+) seconds? after it is asked to stop$/,
	async ({ request: _request }, seconds: string) => {
		setApiEnv({ SHUTDOWN_DRAIN_MS: String(Number(seconds) * MS_PER_SECOND) });
	},
);

Given("the API is running", async ({ request: _request }) => {
	await runningApi();
});

// SIGTERM, as Docker sends it. The step waits for the API's log line, so the next step meets an API that is stopping.
When("the API is asked to stop", async ({ request: _request }) => {
	const api = await runningApi();
	api.process.kill("SIGTERM");
	await pollUntil(async () => api.log.includes(STOPPING_LINE), {
		withinMs: 5000,
		everyMs: 20,
		failure: "the API did not log that it is stopping",
	});
});

Then(
	/^the readiness status is "([^"]+)"$/,
	async ({ request: _request }, status: string) => {
		expect((await currentResponse().json()).status).toBe(status);
	},
);

Then(
	/^the API exits with code (\d+) within (\d+) seconds$/,
	async ({ request: _request }, code: string, seconds: string) => {
		const api = await runningApi();
		const exited =
			api.process.exitCode !== null
				? Promise.resolve(api.process.exitCode)
				: new Promise<number | null>((resolve) =>
						api.process.once("exit", (exitCode) => resolve(exitCode)),
					);
		const late = new Promise<"late">((resolve) =>
			setTimeout(() => resolve("late"), Number(seconds) * MS_PER_SECOND),
		);
		expect(await Promise.race([exited, late])).toBe(Number(code));
	},
);
