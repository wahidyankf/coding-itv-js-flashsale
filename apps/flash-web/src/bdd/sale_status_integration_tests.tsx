// @vitest-environment jsdom
// Runs the status scenarios of specs/apps/flash/web/behaviours/sale/status.feature at the integration layer, in the
// integration world: real HTTP and real time. The steps are in support/bind-sale-status.ts, shared with the unit layer.
// The titles stay here, where the behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindSaleStatus } from "./support/bind-sale-status";
import { integrationWorld } from "./support/integration-world";
import { specFile } from "./support/paths";

const world = await integrationWorld();
afterAll(() => world.close());
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
