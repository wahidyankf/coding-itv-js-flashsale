// Binds specs/apps/flash/be/behaviours/sale/caching.feature at the unit layer: the app over in-memory stores and a clock
// the scenario moves. The steps are in support/bind-sale-caching.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindSaleCaching } from "./support/bind-sale-caching.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindSaleCaching(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/caching.feature")),
	({ Scenario }) => {
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
