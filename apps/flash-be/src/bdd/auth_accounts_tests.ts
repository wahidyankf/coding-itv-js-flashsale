// Binds specs/apps/flash/be/behaviours/auth/accounts.feature at the unit layer: accounts and logins in memory, and the app
// built on them. The steps are in support/bind-auth-accounts.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { unitAuthWorld } from "./support/auth-unit.js";
import { bindAuthAccounts } from "./support/bind-auth-accounts.js";
import { specFile } from "./support/paths.js";

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const steps = bindAuthAccounts(() => unitAuthWorld(apps));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/accounts.feature")),
	({ Scenario, ScenarioOutline }) => {
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

		Scenario(
			"A login records the user as the one who changed their row",
			steps.loginStampsRow,
		);

		ScenarioOutline(
			"A wrong password and an unknown name are refused in the same way",
			steps.refusesWrongLogin,
		);

		Scenario("Only a hash of the password is stored", steps.hashesOnly);
	},
);
