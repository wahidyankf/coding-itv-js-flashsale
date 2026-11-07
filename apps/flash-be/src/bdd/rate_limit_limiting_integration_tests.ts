// Binds specs/apps/flash/be/behaviours/rate-limit/limiting.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-rate-limit-limiting.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindRateLimitLimiting } from "./support/bind-rate-limit-limiting.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindRateLimitLimiting(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/rate-limit/limiting.feature"),
	),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

		ScenarioOutline(
			"Every write route is limited per user",
			steps.limitsEveryRoute,
		);

		Scenario("Another user is not affected", steps.otherUserUnaffected);

		Scenario("A single address is limited across users", steps.addressLimited);

		Scenario(
			"The count starts again in the next window",
			steps.countStartsAgain,
		);
	},
);
