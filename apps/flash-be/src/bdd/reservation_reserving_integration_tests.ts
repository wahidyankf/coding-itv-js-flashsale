// Binds specs/apps/flash/be/behaviours/reservation/reserving.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-reservation-reserving.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindReservationReserving } from "./support/bind-reservation-reserving.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindReservationReserving(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/reservation/reserving.feature"),
	),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

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
