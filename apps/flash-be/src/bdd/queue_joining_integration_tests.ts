// Binds specs/apps/flash/be/behaviours/queue/joining.feature at the integration layer: the real app over the run's Postgres
// and Redis. The steps are in support/bind-queue-joining.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindQueueJoining } from "./support/bind-queue-joining.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindQueueJoining(integrationShopLayer(real.scenario));

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
