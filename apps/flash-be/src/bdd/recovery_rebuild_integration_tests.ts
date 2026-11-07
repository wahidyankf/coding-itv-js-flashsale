// Binds specs/apps/flash/be/behaviours/recovery/rebuild.feature at the integration layer: the real app over the run's
// Postgres and Redis. The steps are in support/bind-recovery-rebuild.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindRecoveryRebuild } from "./support/bind-recovery-rebuild.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindRecoveryRebuild(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/recovery/rebuild.feature")),
	({ Scenario }) => {
		Scenario("Live holds survive the loss of Redis state", steps.survivesLoss);

		Scenario(
			"The holder gets the same hold after the loss",
			steps.sameHoldAfterLoss,
		);

		Scenario("Expired holds are not rebuilt", steps.expiredNotRebuilt);
	},
);
