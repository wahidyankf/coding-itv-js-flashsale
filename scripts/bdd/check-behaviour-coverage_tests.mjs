import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { checkCorpus } from "./check-behaviour-coverage.mjs";
import {
	E2E_OUTLINE,
	E2E_PLAIN_TEXT,
	E2E_WITH_EXTRA,
	E2E_WITHOUT_WHEN,
	EXEMPT_COMMENT,
	FLASH_OWNERS,
	PATHS,
	UNIT_WITH_GHOST,
	UNIT_WITH_OUTLINE,
	UNIT_WITH_TEMPLATE_TITLE,
	VALID,
	withFeature,
} from "./support/fixtures.mjs";

const FEATURE = path.resolve(
	import.meta.dirname,
	"../../specs/tooling/bdd-check/behaviours/corpus-rules.feature",
);
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const roots = [];

afterAll(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

// Writes the files to a temp folder and runs the check. A null value leaves the file out.
async function corpus(files) {
	const root = await mkdtemp(path.join(tmpdir(), "bdd-check-"));
	roots.push(root);
	for (const [rel, text] of Object.entries(files)) {
		if (text === null) continue;
		const abs = path.join(root, rel);
		await mkdir(path.dirname(abs), { recursive: true });
		await writeFile(abs, text);
	}
	return checkCorpus({ root, owners: FLASH_OWNERS });
}

describeFeature(await loadFeature(FEATURE), ({ Scenario }) => {
	Scenario(
		"A corpus bound at every layer passes",
		({ Given, When, Then, And }) => {
			let files;
			let result;

			Given("the corpus binds every scenario at every layer", () => {
				files = VALID;
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the check reports no failures", () => {
				expect(result.failures).toEqual([]);
			});
			And("one behaviour of one is covered", () => {
				expect(result.total).toBe(1);
				expect(result.covered).toBe(1);
			});
		},
	);

	Scenario("A scenario with no unit binding fails", ({ Given, When, Then }) => {
		let files;
		let result;

		Given("the unit binding file is missing", () => {
			files = { ...VALID, [PATHS.unit]: null };
		});
		When("the behaviour check runs", async () => {
			result = await corpus(files);
		});
		Then(
			"the failures name the missing unit binding for Liveness returns ok",
			() => {
				expect(result.failures.join("\n")).toContain(
					"Liveness returns ok: no unit binding",
				);
			},
		);
	});

	Scenario(
		"A scenario with no integration binding fails when it is not exempt",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the integration binding file is missing", () => {
				files = { ...VALID, [PATHS.integration]: null };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then(
				"the failures name the missing integration binding for Liveness returns ok",
				() => {
					expect(result.failures.join("\n")).toContain(
						"Liveness returns ok: no integration binding",
					);
				},
			);
		},
	);

	Scenario(
		"A binding whose title matches no scenario fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the unit binding file also binds a scenario named Ghost", () => {
				files = { ...VALID, [PATHS.unit]: UNIT_WITH_GHOST };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name the unused unit binding Ghost", () => {
				expect(result.failures.join("\n")).toContain(
					"unused unit binding: Ghost",
				);
			});
		},
	);

	Scenario(
		"A dynamic scenario title fails because the checker cannot read it",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given(
				"the unit binding file uses a template title with a placeholder",
				() => {
					files = { ...VALID, [PATHS.unit]: UNIT_WITH_TEMPLATE_TITLE };
				},
			);
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name a dynamic scenario title", () => {
				expect(result.failures.join("\n")).toContain("dynamic scenario title");
			});
		},
	);

	Scenario(
		"A step with no e2e step definition fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given(
				"the e2e steps have no definition for the step a client asks for liveness",
				() => {
					files = { ...VALID, [PATHS.e2e]: E2E_WITHOUT_WHEN };
				},
			);
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name the step that has no e2e definition", () => {
				expect(result.failures.join("\n")).toContain(
					'no e2e step matches "a client asks for liveness"',
				);
			});
		},
	);

	Scenario(
		"A plain-text e2e step matches its text exactly",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the e2e steps define each step as plain text", () => {
				files = { ...VALID, [PATHS.e2e]: E2E_PLAIN_TEXT };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures do not name a missing e2e step", () => {
				expect(result.failures.join("\n")).not.toContain("no e2e step matches");
			});
		},
	);

	Scenario(
		"An e2e step that no scenario uses fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the e2e steps define an extra step that no scenario uses", () => {
				files = { ...VALID, [PATHS.e2e]: E2E_WITH_EXTRA };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name an unused e2e step", () => {
				expect(result.failures.join("\n")).toContain("unused e2e step");
			});
		},
	);

	Scenario(
		"A feature that its README does not link fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the folder README does not link the feature", () => {
				files = { ...VALID, [PATHS.readme]: "# Health\n\nNo links here.\n" };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then(
				"the failures name the feature that its README does not link",
				() => {
					expect(result.failures.join("\n")).toContain(
						"liveness.feature: not linked from README.md",
					);
				},
			);
		},
	);

	Scenario(
		"An exemption with a valid comment and alternative proof passes",
		({ Given, And, When, Then }) => {
			let files;
			let result;

			Given(
				"the scenario is e2e-exempt with a valid comment and alternative proof",
				() => {
					files = withFeature(
						[
							"Feature: Liveness",
							"",
							`  ${EXEMPT_COMMENT}`,
							"  @e2e-exempt",
							"  Scenario: Liveness returns ok",
							"    Given the server is running",
							"    When a client asks for liveness",
							"    Then the answer is ok",
							"",
						].join("\n"),
					);
				},
			);
			And("the e2e steps are absent", () => {
				files = { ...files, [PATHS.e2e]: null };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures are empty", () => {
				expect(result.failures).toEqual([]);
			});
			And("one behaviour of one is covered", () => {
				expect(result.covered).toBe(1);
			});
		},
	);

	Scenario(
		"An exempt scenario with no exemption comment fails",
		({ Given, And, When, Then }) => {
			let files;
			let result;

			Given("the scenario is e2e-exempt without an exemption comment", () => {
				files = withFeature(
					[
						"Feature: Liveness",
						"",
						"  @e2e-exempt",
						"  Scenario: Liveness returns ok",
						"    Given the server is running",
						"",
					].join("\n"),
				);
			});
			And("the e2e steps are absent", () => {
				files = { ...files, [PATHS.e2e]: null };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name the missing e2e exemption comment", () => {
				expect(result.failures.join("\n")).toContain(
					"Liveness returns ok: missing Exemption(e2e) comment",
				);
			});
		},
	);

	Scenario(
		"An exemption comment above a Background fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("an exemption comment sits above a Background", () => {
				files = withFeature(
					[
						"Feature: Liveness",
						"",
						`  ${EXEMPT_COMMENT}`,
						"  Background:",
						"    Given the server is running",
						"",
						"  Scenario: Liveness returns ok",
						"    When a client asks for liveness",
						"    Then the answer is ok",
						"",
					].join("\n"),
				);
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then(
				"the failures name an exemption comment that is not above a scenario",
				() => {
					expect(result.failures.join("\n")).toContain(
						"not directly above a scenario's tags",
					);
				},
			);
		},
	);

	Scenario(
		"An exemption comment with no alternative proof fails",
		({ Given, And, When, Then }) => {
			let files;
			let result;

			Given("the exemption comment has no alternative proof", () => {
				files = withFeature(
					[
						"Feature: Liveness",
						"",
						"  # Exemption(e2e): the rule is decided before the process listens",
						"  @e2e-exempt",
						"  Scenario: Liveness returns ok",
						"    Given the server is running",
						"",
					].join("\n"),
				);
			});
			And("the e2e steps are absent", () => {
				files = { ...files, [PATHS.e2e]: null };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures name a malformed exemption comment", () => {
				expect(result.failures.join("\n")).toContain(
					"malformed exemption comment",
				);
			});
		},
	);

	Scenario(
		"An alternative proof that names a missing scenario fails",
		({ Given, And, When, Then }) => {
			let files;
			let result;

			Given("the alternative proof names a scenario named Ghost", () => {
				files = withFeature(
					[
						"Feature: Liveness",
						"",
						"  # Exemption(e2e): the rule is decided before the process listens; alternative-proof: flash-be:unit / Ghost",
						"  @e2e-exempt",
						"  Scenario: Liveness returns ok",
						"    Given the server is running",
						"",
					].join("\n"),
				);
			});
			And("the e2e steps are absent", () => {
				files = { ...files, [PATHS.e2e]: null };
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then(
				"the failures name an alternative proof whose scenario is not found",
				() => {
					expect(result.failures.join("\n")).toContain(
						"alternative-proof scenario not found: Ghost",
					);
				},
			);
		},
	);

	Scenario("An exemption tag on the Feature fails", ({ Given, When, Then }) => {
		let files;
		let result;

		Given("the exemption tag sits on the Feature", () => {
			files = withFeature(
				[
					"@e2e-exempt",
					"Feature: Liveness",
					"",
					"  Scenario: Liveness returns ok",
					"    Given the server is running",
					"    When a client asks for liveness",
					"    Then the answer is ok",
					"",
				].join("\n"),
			);
		});
		When("the behaviour check runs", async () => {
			result = await corpus(files);
		});
		Then("the failures name an exemption tag on the Feature", () => {
			expect(result.failures.join("\n")).toContain("exemption tag on Feature");
		});
	});

	Scenario("An unknown exemption tag fails", ({ Given, When, Then }) => {
		let files;
		let result;

		Given("the scenario carries the unknown tag unit-exempt", () => {
			files = withFeature(
				[
					"Feature: Liveness",
					"",
					"  @unit-exempt",
					"  Scenario: Liveness returns ok",
					"    Given the server is running",
					"    When a client asks for liveness",
					"    Then the answer is ok",
					"",
				].join("\n"),
			);
		});
		When("the behaviour check runs", async () => {
			result = await corpus(files);
		});
		Then("the failures name an unknown exemption tag", () => {
			expect(result.failures.join("\n")).toContain(
				"unknown exemption tag @unit-exempt",
			);
		});
	});

	Scenario(
		"An integration-exempt scenario with an integration binding fails",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given(
				"the scenario is integration-exempt and still has an integration binding",
				() => {
					files = withFeature(
						[
							"Feature: Liveness",
							"",
							"  # Exemption(integration): the rule is pure; alternative-proof: flash-be:unit / Liveness returns ok",
							"  @integration-exempt",
							"  Scenario: Liveness returns ok",
							"    Given the server is running",
							"    When a client asks for liveness",
							"    Then the answer is ok",
							"",
						].join("\n"),
					);
				},
			);
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then(
				"the failures name an integration exemption with an integration binding",
				() => {
					expect(result.failures.join("\n")).toContain(
						"bound at integration although @integration-exempt",
					);
				},
			);
		},
	);

	Scenario(
		"An outline counts each Examples row as one behaviour",
		({ Given, When, Then, And }) => {
			let files;
			let result;

			Given(
				"the corpus has an outline with two Examples rows, bound at every layer",
				() => {
					files = {
						...withFeature(
							[
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
							].join("\n"),
						),
						[PATHS.unit]: UNIT_WITH_OUTLINE,
						[PATHS.integration]: UNIT_WITH_OUTLINE,
						[PATHS.e2e]: E2E_OUTLINE,
					};
				},
			);
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the failures are empty", () => {
				expect(result.failures).toEqual([]);
			});
			And("two behaviours are counted", () => {
				expect(result.total).toBe(2);
			});
			And("both behaviours are covered", () => {
				expect(result.covered).toBe(2);
			});
		},
	);

	Scenario(
		"The check passes on the real repository",
		({ Given, When, Then, And }) => {
			let root;
			let result;

			Given("the repository's own corpus", () => {
				root = REPO_ROOT;
			});
			When("the behaviour check runs", async () => {
				result = await checkCorpus({ root });
			});
			Then("the check reports no failures", () => {
				expect(result.failures).toEqual([]);
			});
			And("every behaviour is covered", () => {
				expect(result.total).toBeGreaterThan(0);
				expect(result.covered).toBe(result.total);
			});
		},
	);
});
