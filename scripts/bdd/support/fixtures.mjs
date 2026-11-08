// Fixture text for the checker's bindings. It sits outside *_tests.mjs because the checker reads
// Scenario(...) calls from those files, and these strings must stay data, not bindings.

// The one owner the checker tests use, with the folders its bindings must sit in.
export const FLASH_OWNERS = [
	{
		name: "flash-be",
		spec: "specs/apps/flash/be",
		unit: "apps/flash-be/src/bdd",
		integration: "apps/flash-be/src/bdd",
		e2e: "apps/flash-be-e2e/steps",
	},
];

// The paths of the liveness scenario's files. Every corpus names the same files.
export const PATHS = {
	feature: "specs/apps/flash/be/behaviours/health/liveness.feature",
	readme: "specs/apps/flash/be/behaviours/health/README.md",
	unit: "apps/flash-be/src/bdd/health_tests.ts",
	integration: "apps/flash-be/src/bdd/health_integration_tests.ts",
	e2e: "apps/flash-be-e2e/steps/be.steps.ts",
};

// A feature with one scenario. Most corpora start from it, so a test changes one part of it.
const LIVENESS = [
	"Feature: Liveness",
	"",
	"  Scenario: Liveness returns ok",
	"    Given the server is running",
	"    When a client asks for liveness",
	"    Then the answer is ok",
	"",
].join("\n");

// A valid exemption comment for the liveness scenario, with its proof.
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

// The valid corpus with this feature text in place of the liveness feature.
export function withFeature(feature) {
	return { ...VALID, [PATHS.feature]: feature };
}

// A unit file that binds a scenario the feature does not have. The checker must report it.
export const UNIT_WITH_GHOST =
	'Scenario("Liveness returns ok", () => {});\nScenario("Ghost", () => {});\n';

// A unit file whose title is a template literal. The checker must see that title raw, and reject it.
export const UNIT_WITH_TEMPLATE_TITLE =
	// biome-ignore lint/suspicious/noTemplateCurlyInString: the checker must see the raw template title
	'const name = "x";\nScenario(`Liveness ${name}`, () => {});\n';

// A unit file that binds the outline title of OUTLINE_FEATURE.
export const UNIT_WITH_OUTLINE =
	'ScenarioOutline("Liveness returns <state>", () => {});\n';

// E2E steps written as plain text, not as regex. The checker must still bind them.
export const E2E_PLAIN_TEXT = [
	"Given(/^the server is running$/, async () => {});",
	'When("a client asks for liveness", async () => {});',
	'Then("the answer is ok", async () => {});',
	"",
].join("\n");

// E2E steps with no When. A scenario that needs one must fail the check.
export const E2E_WITHOUT_WHEN = [
	"Given(/^the server is running$/, async () => {});",
	"Then(/^the answer is ok$/, async () => {});",
	"",
].join("\n");

// E2E steps plus one step that no scenario uses. The check must report it.
export const E2E_WITH_EXTRA = `${E2E_STEPS}Then(/^nothing uses this$/, async () => {});\n`;

// E2E steps for the outline, with a captured value in the Given.
export const E2E_OUTLINE = [
	'Given(/^the state is "(\\w+)"$/, async () => {});',
	"When(/^a client asks for liveness$/, async () => {});",
	"Then(/^the answer is ok$/, async () => {});",
	"",
].join("\n");
