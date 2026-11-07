// Binds specs/apps/flash/be/behaviours/sale/status.feature at the unit layer: the sales are in memory, and the app is built over
// them with a fixed clock. The steps are in support/bind-status.ts, the same as at the integration layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterEach } from "vitest";
import type { Sale } from "../domain/sale.js";
import {
	bindSaleStatus,
	type NewSale,
	type SaleWorld,
} from "./support/bind-status.js";
import { appWithSales, fakeSale } from "./support/fake-sales.js";
import { specFile } from "./support/paths.js";
import { relativeTime } from "./support/time.js";

// A fixed moment for every scenario, so "in 1 hour" always means the same thing.
const NOW = new Date("2026-06-01T12:00:00Z");
const clock = () => NOW;

const apps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

// The store of one scenario: its sales, read by an app built over them at each request.
function unitWorld(): SaleWorld {
	const sales: Sale[] = [];
	return {
		addSale: async ({ opens, closes, ...fields }: NewSale) => {
			const sale = fakeSale({
				...fields,
				startsAt: relativeTime(opens, NOW),
				endsAt: relativeTime(closes, NOW),
			});
			sales.push(sale);
			return sale.id;
		},
		noSales: async () => {
			sales.length = 0;
		},
		get: async (url) => {
			const app = appWithSales(sales, clock);
			apps.push(app);
			return app.inject({ method: "GET", url });
		},
	};
}

const steps = bindSaleStatus(unitWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline }) => {
		ScenarioOutline(
			"The sale reports its status from its window and its stock",
			steps.reportsStatus,
		);

		Scenario(
			"The current sale is the one that is running, even when a later sale is scheduled",
			steps.currentSale,
		);

		Scenario(
			"With no running sale the current sale is the one that opens next",
			steps.currentSale,
		);

		Scenario(
			"A sale that is over is not the current sale, but it can still be read by its id",
			steps.overKeepsId,
		);

		Scenario("There is no current sale before one is created", steps.noCurrent);

		ScenarioOutline("An unknown sale is refused", steps.unknownSale);
	},
);
