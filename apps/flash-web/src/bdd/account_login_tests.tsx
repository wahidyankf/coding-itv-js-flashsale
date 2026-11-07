// Runs the account scenarios of specs/apps/flash/web/behaviours/account/login.feature at the unit layer, in the unit world.
// The steps are in support/bind-account-login.ts, shared with the integration layer. The titles stay here, where the
// behaviour checker reads them.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { bindAccountLogin } from "./support/bind-account-login";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();
const steps = bindAccountLogin(world);

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/account/login.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		Scenario(
			"A visitor who is not logged in sees the form instead of the buying buttons",
			steps.formForVisitor,
		);

		Scenario("A new shopper signs up and is logged in", steps.signUpLogsIn);

		Scenario("A shopper with an account logs in", steps.logsIn);

		ScenarioOutline(
			"A login or a sign up that the server refuses is explained in words",
			steps.refusedLogin,
		);

		ScenarioOutline(
			"A name or a password that cannot be used is refused on the form",
			steps.invalidSignUp,
		);

		Scenario(
			"A shopper who is logged in is known when the page opens again",
			steps.knownWhenOpenedAgain,
		);

		Scenario("A shopper logs out", steps.logsOut);

		Scenario(
			"A login that lost only its short token carries on without asking again",
			steps.shortTokenEnds,
		);

		Scenario(
			"A login that ended is replaced by the form, with the reason",
			steps.loginEnded,
		);
	},
);
