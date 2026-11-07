// Binds specs/apps/flash/be/behaviours/auth/accounts.feature at the integration layer: the app over the run's Postgres and
// Redis, with real password hashing. The steps are in support/bind-auth-accounts.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { openAuthIntegration } from "./support/auth-integration.js";
import { bindAuthAccounts } from "./support/bind-auth-accounts.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario empties the tables first.
const real = await openAuthIntegration();
afterAll(real.close);
const steps = bindAuthAccounts(real.newWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/accounts.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(real.db);
		});

		Scenario("A new shopper signs up and is logged in", steps.signsUpAndLogsIn);

		Scenario(
			"The name is trimmed and lowercased when signing up",
			steps.trimsName,
		);

		ScenarioOutline(
			"A name or a password that cannot be used is refused",
			steps.refusesUnusable,
		);

		Scenario(
			"A name that is taken is refused, whatever its case",
			steps.nameTaken,
		);

		Scenario("A shopper logs in with the right password", steps.logsIn);

		ScenarioOutline(
			"A wrong password and an unknown name are refused in the same way",
			steps.refusesWrongLogin,
		);

		Scenario("Only a hash of the password is stored", steps.hashesOnly);
	},
);
