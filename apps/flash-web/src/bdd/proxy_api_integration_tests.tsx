// @vitest-environment jsdom
// Runs the proxy scenarios of specs/apps/flash/web/behaviours/proxy/api.feature at the integration layer, in the
// integration world: real HTTP and real time. The steps are in support/bind-proxy-api.ts, shared with the unit layer. The
// titles stay here, where the behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { bindProxyApi } from "./support/bind-proxy-api";
import { integrationWorld } from "./support/integration-world";
import { specFile } from "./support/paths";

const world = await integrationWorld();
afterAll(() => world.close());
const steps = bindProxyApi(world);

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/proxy/api.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		Scenario(
			"The browser reads the sale through the web server",
			steps.readsSaleThroughWeb,
		);

		Scenario(
			"The page does not contain the address of the API",
			steps.pageHidesApi,
		);

		ScenarioOutline(
			"Paths outside the sale are refused",
			steps.pathsOutsideRefused,
		);

		ScenarioOutline(
			"An API path without the version is refused",
			steps.pathsOutsideRefused,
		);

		Scenario(
			"The operator routes are not reachable through the web server",
			steps.operatorRoutesUnreachable,
		);

		Scenario(
			"A write request is passed on with the cookie of the shopper",
			steps.writePassedOn,
		);

		Scenario(
			"A shopper who is not logged in is refused by the API",
			steps.anonymousRefused,
		);

		Scenario(
			"Signing up sets both cookies, and the refresh cookie is set for the auth path",
			steps.signUpSetsCookies,
		);

		Scenario(
			"A request from another site is refused before it reaches the API",
			steps.otherSiteRefused,
		);

		Scenario(
			"The API is told the shopper's own address, not one the browser wrote",
			steps.callerAddressPassedOn,
		);

		Scenario(
			"Each request is given a request id the API and the browser both see",
			steps.requestIdShared,
		);

		Scenario(
			"An API that cannot be reached gives a gateway error",
			steps.apiUnreachable,
		);
	},
);
