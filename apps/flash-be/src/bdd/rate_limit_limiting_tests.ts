// Binds specs/apps/flash/be/behaviours/rate-limit/limiting.feature at the unit layer: the app over in-memory stores and a
// clock the scenario moves. The steps are in support/bind-rate-limit-limiting.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindRateLimitLimiting } from "./support/bind-rate-limit-limiting.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindRateLimitLimiting(unitShopLayer());

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/rate-limit/limiting.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
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
