// Binds specs/apps/flash/be/behaviours/recovery/rebuild.feature at the unit layer: the app over in-memory stores, where
// losing Redis state is a call on the in-memory gate. The steps are in support/bind-recovery-rebuild.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindRecoveryRebuild } from "./support/bind-recovery-rebuild.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindRecoveryRebuild(unitShopLayer());

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
