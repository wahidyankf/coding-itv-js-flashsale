// Binds specs/apps/flash/be/behaviours/purchase/outcome.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-purchase-outcome.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindPurchaseOutcome } from "./support/bind-purchase-outcome.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindPurchaseOutcome(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/purchase/outcome.feature")),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

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
