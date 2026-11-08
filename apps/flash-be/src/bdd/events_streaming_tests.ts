// Binds specs/apps/flash/be/behaviours/events/streaming.feature at the unit layer: the app over in-memory stores, with the
// event streams opened on a real port. The steps are in support/bind-events-streaming.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindEventsStreaming } from "./support/bind-events-streaming.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindEventsStreaming(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/events/streaming.feature")),
	({ Scenario }) => {
		Scenario(
			"A client watching the sale gets its status at once",
			steps.watchesAtOnce,
		);

		Scenario(
			"A change in the sale is pushed to the client",
			steps.pushesChange,
		);

		Scenario("Watching an unknown sale is refused", steps.refusesUnknownSale);

		Scenario(
			"A waiting shopper hears when they are admitted",
			steps.hearsAdmitted,
		);

		Scenario(
			"A shopper watching their place sees it first",
			steps.watchesPlaceFirst,
		);

		Scenario(
			"Watching a place with a wrong ticket is refused",
			steps.refusesWrongPlaceTicket,
		);

		Scenario(
			"A shopper whose place was lost before watching is told it is gone",
			steps.toldPlaceIsGone,
		);
	},
);
