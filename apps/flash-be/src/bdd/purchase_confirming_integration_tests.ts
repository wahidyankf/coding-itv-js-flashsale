// Binds specs/apps/flash/be/behaviours/purchase/confirming.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-purchase-confirming.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindPurchaseConfirming } from "./support/bind-purchase-confirming.js";
import { bindChargeGivenBack } from "./support/bind-purchase-given-back.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindPurchaseConfirming(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/purchase/confirming.feature"),
	),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

		Scenario("A shopper pays for the held item", steps.paysForHeld);

		Scenario("Confirming again returns the same purchase", steps.confirmsAgain);

		Scenario("A buyer cannot reserve a second item", steps.noSecondItem);

		Scenario(
			"A reservation id that does not exist is refused",
			steps.refusesUnknownId,
		);

		Scenario(
			"A reservation id that is not an id is refused",
			steps.refusesNonId,
		);

		Scenario(
			"Somebody else's reservation cannot be confirmed",
			steps.refusesOthersHold,
		);

		Scenario(
			"A hold that has expired cannot be confirmed",
			steps.refusesExpiredHold,
		);

		Scenario("A declined payment keeps the hold", steps.keepsHoldOnDecline);

		Scenario(
			"A payment that finishes after the item is gone is refunded",
			steps.refundsLatePayment,
		);

		Scenario(
			"Two confirmations of one hold on two instances charge once",
			steps.chargesOnceOnTwoInstances,
		);

		Scenario(
			"A shopper who is declined and tries again is charged once",
			steps.chargesOnceAfterDecline,
		);

		Scenario(
			"A confirm whose charge another confirm gave back first is refused, and the hold stays",
			bindChargeGivenBack(integrationShopLayer(real.scenario)),
		);

		Scenario(
			"Many buyers confirming at once sell exactly the stock",
			steps.sellsExactlyStock,
		);

		Scenario(
			"A confirmation that names no reservation is refused",
			steps.refusesEmptyBody,
		);

		Scenario(
			"A hold cannot be paid for once the sale has ended",
			steps.refusesEndedSale,
		);

		Scenario(
			"A buyer who confirms another reservation is told they already bought",
			steps.refusesSecondPurchase,
		);
	},
);
