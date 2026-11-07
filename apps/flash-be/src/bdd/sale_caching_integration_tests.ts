// Binds specs/apps/flash/be/behaviours/sale/caching.feature at the integration layer: the real app over the run's Postgres
// and Redis. The steps are in support/bind-sale-caching.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindSaleCaching } from "./support/bind-sale-caching.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindSaleCaching(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/caching.feature")),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			real.resetSettings();
			await resetSales(real.db);
		});

		Scenario(
			"A sale read is answered from the cache for the cache time",
			steps.cachedRead,
		);

		Scenario(
			"A change shows once the cache time is over",
			steps.changeAfterCache,
		);

		Scenario(
			"Without a cache time every read is fresh",
			steps.freshWithoutCache,
		);

		Scenario(
			"A cached reply tells clients how long they may keep it",
			steps.tellsCacheTime,
		);

		Scenario("A sale that is not found is not cached", steps.notFoundNotCached);

		Scenario(
			"Joining the queue does not read the cache",
			steps.joiningSkipsCache,
		);
	},
);
