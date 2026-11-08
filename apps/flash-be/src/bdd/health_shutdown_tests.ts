// Binds specs/apps/flash/be/behaviours/health/shutdown.feature at the unit layer: the app over fake services on a real
// socket, stopped by the shutdown of shutdown.ts. The steps are in support/bind-health-shutdown.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindHealthShutdown } from "./support/bind-health-shutdown.js";
import { specFile } from "./support/paths.js";
import { unitStoppingWorld } from "./support/stopping-unit.js";

const steps = bindHealthShutdown(unitStoppingWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/shutdown.feature")),
	({ Scenario }) => {
		Scenario(
			"Readiness answers 503 once the API is asked to stop",
			steps.readinessStops,
		);

		Scenario(
			"A request in flight when the API is asked to stop still gets its answer",
			steps.requestInFlight,
		);

		Scenario(
			"Open event streams are ended when the API stops",
			steps.streamsEnded,
		);

		Scenario("The API exits once its work is done", steps.exitsWhenDone);
	},
);
