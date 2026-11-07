// Runs the status scenarios of specs/apps/flash/web/behaviours/sale/status.feature at the unit layer, in the unit world.
// The steps are in support/bind-sale-status.ts, shared with the integration layer. The titles stay here, where the
// behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindSaleStatus } from "./support/bind-sale-status";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();
const steps = bindSaleStatus(world);

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		ScenarioOutline(
			"The page shows the sale and its status",
			steps.showsSaleStatus,
		);

		Scenario("The page says so when the last sale is over", steps.lastSaleOver);

		Scenario("The page follows the sale to its end", steps.followsToEnd);

		Scenario("The page says so when no sale exists", steps.noSale);

		Scenario("The page follows the sale as it changes", steps.followsChanges);

		Scenario(
			"The page says so when the sale cannot be reached",
			steps.cannotBeReached,
		);

		Scenario("The page says so when live updates stop", steps.liveUpdatesStop);
	},
);
