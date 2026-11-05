import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { checkCorpus } from "./check-behaviour-coverage.mjs";
import { CORPORA, DEFECTS } from "./support/defects.mjs";
import { FLASH_OWNERS } from "./support/fixtures.mjs";

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

// Calls the checker in-process on a temp corpus. A null value leaves the file out.
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

describeFeature(await loadFeature(FEATURE), ({ Scenario, ScenarioOutline }) => {
	ScenarioOutline(
		"The check rejects a corpus with <defect>",
		({ Given, When, Then, And }, examples) => {
			let files;
			let result;

			Given("the corpus has the defect <defect>", () => {
				files = DEFECTS[examples.defect]();
			});
			When("the behaviour check runs", async () => {
				result = await corpus(files);
			});
			Then("the check reports failures", () => {
				expect(result.failures.length).toBeGreaterThan(0);
			});
			And("the failures name <problem>", () => {
				expect(result.failures.join("\n")).toContain(examples.problem);
			});
		},
	);

	Scenario(
		"A corpus bound at every layer passes",
		({ Given, When, Then, And }) => {
			let files;
			let result;

			Given("the corpus binds every scenario at every layer", () => {
				files = CORPORA["bound at every layer"]();
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

	Scenario(
		"A plain-text e2e step matches its text exactly",
		({ Given, When, Then }) => {
			let files;
			let result;

			Given("the e2e steps define each step as plain text", () => {
				files = CORPORA["plain-text e2e steps"]();
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
		"An exemption with a valid comment and alternative proof passes",
		({ Given, And, When, Then }) => {
			let files;
			let result;

			Given(
				"the scenario is e2e-exempt with a valid comment and alternative proof",
				() => {
					files = CORPORA["valid exemption"]();
				},
			);
			And("the e2e steps are absent", () => {
				files = { ...files, "apps/flash-be-e2e/steps/be.steps.ts": null };
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
		"An outline counts each Examples row as one behaviour",
		({ Given, When, Then, And }) => {
			let files;
			let result;

			Given(
				"the corpus has an outline with two Examples rows, bound at every layer",
				() => {
					files = CORPORA["outline with two rows"]();
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
