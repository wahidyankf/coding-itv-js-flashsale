// Runs the buying scenarios of specs/apps/flash/web/behaviours/sale/buying.feature at the unit layer, in the unit world. The
// steps are in support/bind-sale-buying.ts, shared with the integration layer. The titles stay here, where the behaviour
// checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindSaleBuying } from "./support/bind-sale-buying";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();
const steps = bindSaleBuying(world);

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/buying.feature")),
	({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		Scenario("A shopper buys the item", steps.buysItem);

		Scenario("A waiting shopper sees their place", steps.waitingSeesPlace);

		Scenario("A shopper who is told the item is gone", steps.toldGone);

		Scenario("A shopper who already bought is told so", steps.alreadyBought);

		Scenario(
			"A shopper who waits while the sale ends is told so",
			steps.waitsSaleEnds,
		);

		Scenario(
			"A shopper who waits while the last items are sold is told so",
			steps.waitsLastItemsSold,
		);

		Scenario(
			"A shopper who sends too many requests is told to wait",
			steps.tooManyRequests,
		);

		Scenario("A declined payment keeps the hold", steps.declinedKeepsHold);

		Scenario("A hold that runs out is shown as ended", steps.holdEnds);
	},
);
