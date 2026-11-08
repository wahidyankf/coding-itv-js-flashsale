// Binds specs/apps/flash/be/behaviours/auth/sessions.feature at the integration layer: the app over the run's Postgres and
// Redis, with real password hashing. The steps are in support/bind-auth-sessions.ts, the same as at the unit layer.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { openAuthIntegration } from "./support/auth-integration.js";
import { bindAuthSessions } from "./support/bind-auth-sessions.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario empties the tables first.
const real = await openAuthIntegration();
afterAll(real.close);
const steps = bindAuthSessions(real.newWorld);

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/sessions.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(real.db);
		});

		Scenario("A shopper asks who is logged in", steps.asksLoggedIn);

		Scenario(
			"A refresh token that has run out is refused, and the session stays open",
			steps.refusesExpiredRefresh,
		);

		Scenario("Logging out ends the login", steps.logsOutEnds);

		Scenario("Logging out twice is harmless", steps.logsOutTwice);

		Scenario(
			"An access token that has expired is refused",
			steps.refusesExpiredAccess,
		);

		Scenario(
			"The refresh token trades for a new pair of tokens",
			steps.refreshTrades,
		);

		Scenario(
			"A refresh token used twice ends the login",
			steps.refreshTwiceEnds,
		);

		Scenario(
			"A refresh without a refresh token is refused",
			steps.refreshWithoutToken,
		);

		Scenario(
			"The refresh cookie is sent only to the auth paths",
			steps.cookieLimitedToAuth,
		);

		ScenarioOutline(
			"The routes of a shopper need a login",
			steps.routesNeedLogin,
		);

		Scenario(
			"A login made on one instance is accepted by another",
			steps.loginAcrossInstances,
		);

		Scenario(
			"Logging out on one instance ends the login on every instance",
			steps.logoutAcrossInstances,
		);

		Scenario(
			"A refresh on one instance is honoured by another",
			steps.refreshAcrossInstances,
		);
	},
);
