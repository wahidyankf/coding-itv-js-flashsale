// The corpora behind the checker's bindings. Every layer builds its corpora here, so a rule is
// defined once and run through unit, integration and e2e. Keys match the names in the feature.
import {
	E2E_OUTLINE,
	E2E_PLAIN_TEXT,
	E2E_WITH_EXTRA,
	E2E_WITHOUT_WHEN,
	EXEMPT_COMMENT,
	PATHS,
	UNIT_WITH_GHOST,
	UNIT_WITH_OUTLINE,
	UNIT_WITH_TEMPLATE_TITLE,
	VALID,
	withFeature,
} from "./fixtures.mjs";

const SCENARIO = "  Scenario: Liveness returns ok";
const STEPS = [
	"    Given the server is running",
	"    When a client asks for liveness",
	"    Then the answer is ok",
];

const VALID_EXEMPTION = [
	"Feature: Liveness",
	"",
	`  ${EXEMPT_COMMENT}`,
	"  @e2e-exempt",
	SCENARIO,
	...STEPS,
	"",
].join("\n");

const EXEMPT_WITHOUT_COMMENT = [
	"Feature: Liveness",
	"",
	"  @e2e-exempt",
	SCENARIO,
	"    Given the server is running",
	"",
].join("\n");

const COMMENT_ABOVE_BACKGROUND = [
	"Feature: Liveness",
	"",
	`  ${EXEMPT_COMMENT}`,
	"  Background:",
	"    Given the server is running",
	"",
	SCENARIO,
	"    When a client asks for liveness",
	"    Then the answer is ok",
	"",
].join("\n");

const COMMENT_WITHOUT_PROOF = [
	"Feature: Liveness",
	"",
	"  # Exemption(e2e): the rule is decided before the process listens",
	"  @e2e-exempt",
	SCENARIO,
	"    Given the server is running",
	"",
].join("\n");

const PROOF_MISSING = [
	"Feature: Liveness",
	"",
	"  # Exemption(e2e): the rule is decided before the process listens; alternative-proof: flash-be:unit / Ghost",
	"  @e2e-exempt",
	SCENARIO,
	"    Given the server is running",
	"",
].join("\n");

const TAG_ON_FEATURE = [
	"@e2e-exempt",
	"Feature: Liveness",
	"",
	SCENARIO,
	...STEPS,
	"",
].join("\n");

const UNKNOWN_TAG = [
	"Feature: Liveness",
	"",
	"  @unit-exempt",
	SCENARIO,
	...STEPS,
	"",
].join("\n");

const INTEGRATION_EXEMPT_BOUND = [
	"Feature: Liveness",
	"",
	"  # Exemption(integration): the rule is pure; alternative-proof: flash-be:unit / Liveness returns ok",
	"  @integration-exempt",
	SCENARIO,
	...STEPS,
	"",
].join("\n");

export const OUTLINE_FEATURE = [
	"Feature: Liveness",
	"",
	"  Scenario Outline: Liveness returns <state>",
	'    Given the state is "<state>"',
	"    When a client asks for liveness",
	"    Then the answer is ok",
	"",
	"    Examples:",
	"      | state |",
	"      | ok    |",
	"      | fine  |",
	"",
].join("\n");

// One corpus per defect. Each one breaks exactly one rule.
export const DEFECTS = {
	"unit binding missing": () => ({ ...VALID, [PATHS.unit]: null }),
	"integration binding missing": () => ({
		...VALID,
		[PATHS.integration]: null,
	}),
	"unused binding": () => ({ ...VALID, [PATHS.unit]: UNIT_WITH_GHOST }),
	"template title": () => ({
		...VALID,
		[PATHS.unit]: UNIT_WITH_TEMPLATE_TITLE,
	}),
	"e2e step missing": () => ({ ...VALID, [PATHS.e2e]: E2E_WITHOUT_WHEN }),
	"e2e step unused": () => ({ ...VALID, [PATHS.e2e]: E2E_WITH_EXTRA }),
	"README link missing": () => ({
		...VALID,
		[PATHS.readme]: "# Health\n\nNo links here.\n",
	}),
	"exemption comment missing": () => ({
		...withFeature(EXEMPT_WITHOUT_COMMENT),
		[PATHS.e2e]: null,
	}),
	"comment above a Background": () => withFeature(COMMENT_ABOVE_BACKGROUND),
	"comment without proof": () => ({
		...withFeature(COMMENT_WITHOUT_PROOF),
		[PATHS.e2e]: null,
	}),
	"proof names a missing scenario": () => ({
		...withFeature(PROOF_MISSING),
		[PATHS.e2e]: null,
	}),
	"exemption tag on the Feature": () => withFeature(TAG_ON_FEATURE),
	"unknown exemption tag": () => withFeature(UNKNOWN_TAG),
	"integration exemption still bound": () =>
		withFeature(INTEGRATION_EXEMPT_BOUND),
};

// Corpora that a passing scenario starts from.
export const CORPORA = {
	"bound at every layer": () => VALID,
	"plain-text e2e steps": () => ({ ...VALID, [PATHS.e2e]: E2E_PLAIN_TEXT }),
	"valid exemption": () => ({
		...withFeature(VALID_EXEMPTION),
		[PATHS.e2e]: null,
	}),
	"outline with two rows": () => ({
		...withFeature(OUTLINE_FEATURE),
		[PATHS.unit]: UNIT_WITH_OUTLINE,
		[PATHS.integration]: UNIT_WITH_OUTLINE,
		[PATHS.e2e]: E2E_OUTLINE,
	}),
};
