// Binds specs/apps/flash/be/behaviours/events/streaming.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-events-streaming.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindEventsStreaming } from "./support/bind-events-streaming.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindEventsStreaming(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/events/streaming.feature")),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			real.resetSettings();
			await resetSales(real.db);
		});

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
