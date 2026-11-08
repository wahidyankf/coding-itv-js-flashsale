// Binds specs/apps/flash/be/behaviours/queue/admission.feature at the integration layer: the real app over the run's Postgres
// and Redis. The steps are in support/bind-queue-admission.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindQueueAdmission } from "./support/bind-queue-admission.js";
import { specFile } from "./support/paths.js";
import {
	integrationShopLayer,
	openQueueIntegration,
} from "./support/queue-integration.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);
const steps = bindQueueAdmission(integrationShopLayer(real.scenario));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/admission.feature")),
	({ Scenario, BeforeEachScenario }) => {
		// The server admits shoppers to the sale it shows now. A sale left by an earlier scenario could be that
		// sale, so the sales are cleared first, and an admission time a scenario shortened is put back.
		BeforeEachScenario(async () => {
			real.resetSettings();
			await resetSales(real.db);
		});

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
