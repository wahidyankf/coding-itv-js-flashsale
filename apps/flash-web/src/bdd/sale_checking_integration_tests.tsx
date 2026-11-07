// @vitest-environment jsdom
// Runs the checking scenarios of specs/apps/flash/web/behaviours/sale/checking.feature at the integration layer, in the
// integration world: real HTTP and real time. The steps are in support/bind-sale-checking.ts, shared with the unit layer.
// The titles stay here, where the behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindSaleChecking } from "./support/bind-sale-checking";
import { integrationWorld } from "./support/integration-world";
import { specFile } from "./support/paths";

const world = await integrationWorld();
afterAll(() => world.close());
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

		Scenario(
			"A shopper who bought sees the Purchase ID after checking",
			steps.seesPurchaseId,
		);
	},
);
