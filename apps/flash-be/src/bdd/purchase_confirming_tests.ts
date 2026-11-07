// Binds specs/apps/flash/be/behaviours/purchase/confirming.feature at the unit layer: the app over in-memory stores and a
// clock the scenario moves. The steps are in support/bind-purchase-confirming.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindPurchaseConfirming } from "./support/bind-purchase-confirming.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindPurchaseConfirming(unitShopLayer());

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/purchase/confirming.feature"),
	),
	({ Scenario }) => {
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
			"Many buyers confirming at once sell exactly the stock",
			steps.sellsExactlyStock,
		);
	},
);
