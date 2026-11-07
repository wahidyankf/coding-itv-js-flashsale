// Binds specs/apps/flash/be/behaviours/reservation/reserving.feature at the unit layer: the app over in-memory stores and a
// clock the scenario moves. The steps are in support/bind-reservation-reserving.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindReservationReserving } from "./support/bind-reservation-reserving.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindReservationReserving(unitShopLayer());

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/reservation/reserving.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
		Scenario("An admitted shopper reserves an item", steps.reservesItem);

		Scenario("Reserving again returns the same hold", steps.reservesAgain);

		Scenario(
			"A shopper who is still waiting cannot reserve",
			steps.waitingCannotReserve,
		);

		Scenario(
			"A shopper with a wrong ticket cannot reserve",
			steps.wrongTicketCannotReserve,
		);

		Scenario("A buyer is told so when the queue was lost", steps.toldQueueLost);

		ScenarioOutline(
			"A sale that is not selling does not take reservations",
			steps.notSelling,
		);

		Scenario(
			"Reserving in an unknown sale is refused",
			steps.refusesUnknownSale,
		);

		Scenario("Holds count against the stock", steps.holdsCountAgainstStock);

		Scenario("An expired hold gives the item back", steps.expiredHoldGivesBack);

		Scenario(
			"Many shoppers reserving at once never hold more than the stock",
			steps.manyReserveAtOnce,
		);

		Scenario(
			"A failed write to Postgres gives the item back",
			steps.writeFailureGivesBack,
		);
	},
);
