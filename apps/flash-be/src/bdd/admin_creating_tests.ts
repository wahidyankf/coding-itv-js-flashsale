// Binds specs/apps/flash/be/behaviours/sale/admin.feature (creating) at the unit layer: the operator world over in-memory
// stores. The steps are in support/bind-admin-creating.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { bindAdminCreating } from "./support/bind-admin-creating.js";
import { unitOperatingWorld } from "./support/operating-unit.js";
import { specFile } from "./support/paths.js";

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const steps = bindAdminCreating(() => unitOperatingWorld(apps));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/admin.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"An operator creates a sale and shoppers see it",
			steps.createsSale,
		);

		Scenario(
			"A request from someone who is not logged in is refused",
			steps.refusesAnonymous,
		);

		Scenario("A shopper cannot create a sale", steps.shopperRefused);

		ScenarioOutline(
			"A sale that cannot work is refused",
			steps.refusesUnworkable,
		);

		Scenario(
			"A sale whose window overlaps another sale is refused",
			steps.refusesOverlap,
		);

		Scenario(
			"A sale that opens when another one closes is accepted",
			steps.acceptsAfterClose,
		);

		Scenario(
			"Operators who create the same window at once get one sale",
			steps.oneSaleForSameWindow,
		);

		Scenario(
			"An operator creates a sale for a product that exists",
			steps.createsForProduct,
		);

		Scenario(
			"A sale for a product that does not exist is refused",
			steps.refusesUnknownProduct,
		);

		Scenario(
			"Sales created without a product share one product",
			steps.sharesProduct,
		);
	},
);
