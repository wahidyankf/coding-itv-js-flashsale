// Binds specs/apps/flash/be/behaviours/queue/joining.feature at the unit layer: the app over in-memory stores and a clock
// the scenario moves. The steps are in support/bind-queue-joining.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindQueueJoining } from "./support/bind-queue-joining.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindQueueJoining(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/joining.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"Joining the queue returns a ticket and a place",
			steps.returnsTicket,
		);

		Scenario("Shoppers are placed in the order they join", steps.placedInOrder);

		Scenario("Joining twice keeps the place and the ticket", steps.joinsTwice);

		ScenarioOutline(
			"A sale that cannot sell any more does not take new shoppers",
			steps.refusesFullSale,
		);

		Scenario(
			"Joining the queue of an unknown sale is refused",
			steps.refusesUnknownSale,
		);
	},
);
