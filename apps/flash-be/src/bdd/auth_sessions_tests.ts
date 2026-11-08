// Binds specs/apps/flash/be/behaviours/auth/sessions.feature at the unit layer: accounts and logins in memory, and the app
// built on them. The steps are in support/bind-auth-sessions.ts.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll } from "vitest";
import { unitAuthWorld } from "./support/auth-unit.js";
import { bindAuthSessions } from "./support/bind-auth-sessions.js";
import { specFile } from "./support/paths.js";

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const steps = bindAuthSessions(() => unitAuthWorld(apps));

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/sessions.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario("A shopper asks who is logged in", steps.asksLoggedIn);

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
