// Binds specs/apps/flash/be/behaviours/sale/operating.feature at the unit layer: the operator world over in-memory stores.
// The steps are in support/bind-admin-operating.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { bindAdminOperating } from "./support/bind-admin-operating.js";
import { unitOperatingWorld } from "./support/operating-unit.js";
import { specFile } from "./support/paths.js";

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const steps = bindAdminOperating(() => unitOperatingWorld(apps));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/operating.feature")),
	({ Scenario, ScenarioOutline }) => {
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
			"Shoppers no longer see a sale the operator removed",
			steps.hidesRemovedSale,
		);

		ScenarioOutline(
			"Changing or removing a sale that does not exist is refused",
			steps.refusesUnknownSaleOutline,
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
