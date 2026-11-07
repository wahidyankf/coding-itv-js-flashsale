// Binds specs/apps/flash/be/behaviours/purchase/outcome.feature at the unit layer: the app over in-memory stores and a clock
// the scenario moves. The steps are in support/bind-purchase-outcome.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindPurchaseOutcome } from "./support/bind-purchase-outcome.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindPurchaseOutcome(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/purchase/outcome.feature")),
	({ Scenario }) => {
		Scenario("A buyer sees the purchase", steps.buyerSeesPurchase);

		Scenario("A shopper who holds an item sees the hold", steps.holdIsSeen);

		Scenario("A shopper with nothing sees none", steps.nothingIsSeen);

		Scenario("An expired hold is no longer shown", steps.expiredHoldIsHidden);

		Scenario(
			"The outcome of an unknown sale is refused",
			steps.unknownSaleRefused,
		);
	},
);
