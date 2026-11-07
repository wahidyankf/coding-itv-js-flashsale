// Binds specs/apps/flash/be/behaviours/sale/operating.feature at the integration layer: the operator world over the run's
// Postgres and Redis, through the real app. The steps are in support/bind-admin-operating.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindAdminOperating } from "./support/bind-admin-operating.js";
import { openOperatingIntegration } from "./support/operating-integration.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const real = await openOperatingIntegration();
afterAll(real.close);
const steps = bindAdminOperating(real.newWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/operating.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(real.db);
		});

		Scenario(
			"An operator changes a sale that has not started",
			steps.changesNotStarted,
		);

		Scenario(
			"A sale that has started can get more stock",
			steps.growsStartedSale,
		);

		ScenarioOutline(
			"A sale that has started keeps its start and its stock",
			steps.keepsStartOfStartedSale,
		);

		Scenario("A sale that is over cannot be changed", steps.overStaysAsIs);

		Scenario(
			"A change that would overlap another sale is refused",
			steps.refusesOverlappingMove,
		);

		Scenario(
			"A change that makes the sale unusable is refused",
			steps.refusesUnusableChange,
		);

		Scenario(
			"An operator removes a sale that nobody bought from",
			steps.removesUnbought,
		);

		Scenario(
			"A removed sale stays as a row marked deleted by the operator",
			steps.keepsRemovedRow,
		);

		Scenario(
			"A sale with a purchase cannot be removed",
			steps.refusesRemovalWithPurchase,
		);

		Scenario(
			"An operator lists every sale, the one that opens last first",
			steps.listsNewestFirst,
		);

		ScenarioOutline(
			"Changing, removing and listing need a login",
			steps.needsLoginOutline,
		);

		ScenarioOutline(
			"Changing, removing and listing are for operators only",
			steps.operatorsOnlyOutline,
		);
	},
);
