// Runs the checking scenarios of specs/apps/flash/web/behaviours/sale/checking.feature at the unit layer, in the unit world.
// The steps are in support/bind-sale-checking.ts, shared with the integration layer. The titles stay here, where the
// behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindSaleChecking } from "./support/bind-sale-checking";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();
const steps = bindSaleChecking(world);

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/checking.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		ScenarioOutline("A shopper checks the outcome", steps.checksOutcome);

		Scenario(
			"A shopper who holds an item can confirm after checking",
			steps.confirmsAfterChecking,
		);
	},
);
