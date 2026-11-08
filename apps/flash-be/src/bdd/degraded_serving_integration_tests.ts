// Binds specs/apps/flash/be/behaviours/degraded/serving.feature at the integration layer: the real app over the run's
// Postgres and Redis, where Redis is switched off through the app's own connection. The steps are in
// support/bind-degraded-serving.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindDegradedServing } from "./support/bind-degraded-serving.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindDegradedServing(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/degraded/serving.feature")),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

		Scenario(
			"A shopper joining the queue gets a ticket and is admitted at once",
			steps.joinsWithoutRedis,
		);

		Scenario("A shopper reserves an item", steps.reservesWithoutRedis);

		Scenario(
			"Reserving again without Redis returns the same hold",
			steps.reservesAgainWithoutRedis,
		);

		Scenario(
			"Reserving again without Redis after the hold expired keeps the old hold as a row marked deleted",
			steps.reservesAgainAfterExpiryWithoutRedis,
		);

		Scenario(
			"Many shoppers reserving at once without Redis never hold more than the stock",
			steps.manyReserveWithoutRedis,
		);

		Scenario(
			"A shopper pays for a hold taken before Redis went down",
			steps.paysForHoldBeforeOutage,
		);

		Scenario(
			"Paying while Redis is down is not slowed down",
			steps.paysWithoutSlowdown,
		);

		Scenario(
			"A buyer who has bought cannot reserve again while Redis is down",
			steps.refusesAgainWithoutRedis,
		);

		Scenario("Requests are still limited", steps.stillLimited);

		Scenario(
			"A hold taken while Redis was down is counted when it comes back with its old data",
			steps.countedWithOldData,
		);

		Scenario(
			"A hold taken while Redis was down survives when it comes back with no data",
			steps.survivesNoData,
		);
	},
);
