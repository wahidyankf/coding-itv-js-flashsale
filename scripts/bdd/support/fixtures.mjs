// Fixture text for the checker's bindings. It sits outside *_tests.mjs because the checker reads
// Scenario(...) calls from those files, and these strings must stay data, not bindings.

export const FLASH_OWNERS = [
	{
		name: "flash-be",
		spec: "specs/flash/be",
		unit: "apps/flash-be/src/bdd",
		integration: "apps/flash-be/src/bdd",
		e2e: "apps/flash-be-e2e/steps",
	},
];

export const PATHS = {
	feature: "specs/flash/be/behaviours/health/liveness.feature",
	readme: "specs/flash/be/behaviours/health/README.md",
	unit: "apps/flash-be/src/bdd/health_tests.ts",
	integration: "apps/flash-be/src/bdd/health_integration_tests.ts",
	e2e: "apps/flash-be-e2e/steps/be.steps.ts",
};

export const LIVENESS = [
	"Feature: Liveness",
	"",
	"  Scenario: Liveness returns ok",
	"    Given the server is running",
	"    When a client asks for liveness",
	"    Then the answer is ok",
	"",
].join("\n");

export const EXEMPT_COMMENT =
	"# Exemption(e2e): the rule is decided before the process listens; alternative-proof: flash-be:unit / Liveness returns ok";

const E2E_STEPS = [
	"Given(/^the server is running$/, async () => {});",
	"When(/^a client asks for liveness$/, async () => {});",
	"Then(/^the answer is ok$/, async () => {});",
	"",
].join("\n");

// A corpus where the one scenario is bound at every layer. Each rule changes one part of it.
export const VALID = {
	[PATHS.feature]: LIVENESS,
	[PATHS.readme]: "# Health\n\n- [liveness.feature](liveness.feature)\n",
	[PATHS.unit]: 'Scenario("Liveness returns ok", () => {});\n',
	[PATHS.integration]: 'Scenario("Liveness returns ok", () => {});\n',
	[PATHS.e2e]: E2E_STEPS,
};

export function withFeature(feature) {
	return { ...VALID, [PATHS.feature]: feature };
}

export const UNIT_WITH_GHOST =
	'Scenario("Liveness returns ok", () => {});\nScenario("Ghost", () => {});\n';

export const UNIT_WITH_TEMPLATE_TITLE =
	// biome-ignore lint/suspicious/noTemplateCurlyInString: the checker must see the raw template title
	'const name = "x";\nScenario(`Liveness ${name}`, () => {});\n';

export const UNIT_WITH_OUTLINE =
	'ScenarioOutline("Liveness returns <state>", () => {});\n';

export const E2E_PLAIN_TEXT = [
	"Given(/^the server is running$/, async () => {});",
	'When("a client asks for liveness", async () => {});',
	'Then("the answer is ok", async () => {});',
	"",
].join("\n");

export const E2E_WITHOUT_WHEN = [
	"Given(/^the server is running$/, async () => {});",
	"Then(/^the answer is ok$/, async () => {});",
	"",
].join("\n");

export const E2E_WITH_EXTRA = `${E2E_STEPS}Then(/^nothing uses this$/, async () => {});\n`;

export const E2E_OUTLINE = [
	'Given(/^the state is "(\\w+)"$/, async () => {});',
	"When(/^a client asks for liveness$/, async () => {});",
	"Then(/^the answer is ok$/, async () => {});",
	"",
].join("\n");
