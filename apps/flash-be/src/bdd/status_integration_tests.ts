// Binds specs/apps/flash/be/behaviours/sale/status.feature at the integration layer: sales are rows in the run's database, and
// the app over the real clients reads them. The steps are in support/bind-status.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { bindSaleStatus, type SaleWorld } from "./support/bind-status.js";
import { specFile } from "./support/paths.js";
import { insertSale, resetSales } from "./support/seed.js";
import { relativeTime } from "./support/time.js";

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const app = buildApp(dependenciesFrom(db, redis, config), {
	cookieSecure: false,
});

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

// The store is the run's database, and the app reads it. A window is counted from the moment the sale is added.
const world: SaleWorld = {
	addSale: async ({ opens, closes, ...fields }) => {
		const now = new Date();
		return insertSale(db, {
			...fields,
			startsAt: relativeTime(opens, now),
			endsAt: relativeTime(closes, now),
		});
	},
	noSales: () => resetSales(db),
	get: (url) => app.inject({ method: "GET", url }),
};

const steps = bindSaleStatus(() => world);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

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
	{ excludeTags: ["integration-exempt"] },
);
