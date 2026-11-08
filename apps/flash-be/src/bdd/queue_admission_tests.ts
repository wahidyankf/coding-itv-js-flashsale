// Binds specs/apps/flash/be/behaviours/queue/admission.feature at the unit layer: the app over in-memory stores and a clock
// the scenario moves. The steps are in support/bind-queue-admission.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindQueueAdmission } from "./support/bind-queue-admission.js";
import { specFile } from "./support/paths.js";
import { unitShopLayer } from "./support/queue-world.js";

const steps = bindQueueAdmission(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/admission.feature")),
	({ Scenario }) => {
		Scenario(
			"The queue admits shoppers in order at the sale's rate",
			steps.admitsInOrder,
		);

		Scenario("Nobody is admitted before the sale opens", steps.waitsBeforeOpen);

		Scenario(
			"The queue of the running sale is admitted while a later sale is scheduled",
			steps.admitsRunningSale,
		);

		Scenario("A shopper reads their place with their ticket", steps.readsPlace);

		Scenario("A wrong ticket is refused", steps.refusesWrongTicket);

		Scenario(
			"A shopper whose place was lost is told to join again",
			steps.placeLost,
		);

		Scenario("An admission that is not used in time ends", steps.admissionEnds);

		Scenario(
			"A shopper whose admission ended joins the line again",
			steps.joinsAgainAfterAdmission,
		);
	},
);
