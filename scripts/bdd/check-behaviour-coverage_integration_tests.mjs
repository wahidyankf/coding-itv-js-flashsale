import { spawnSync } from "node:child_process";
import path from "node:path";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO_ROOT, "scripts/bdd/check-behaviour-coverage.mjs");
const FEATURE = path.resolve(
	import.meta.dirname,
	"../../specs/tooling/bdd-check/behaviours/corpus-rules.feature",
);

// Only scenarios without @integration-exempt run here. This one runs the real command.
describeFeature(
	await loadFeature(FEATURE),
	({ Scenario }) => {
		Scenario(
			"The check passes on the real repository",
			({ Given, When, Then, And }) => {
				let run;

				Given("the repository's own corpus", () => {
					// The command reads the repository itself, so there is nothing to set up.
				});
				When("the behaviour check runs", () => {
					run = spawnSync(process.execPath, [CLI], {
						cwd: REPO_ROOT,
						encoding: "utf8",
					});
				});
				Then("the check reports no failures", () => {
					expect(run.status, run.stderr).toBe(0);
				});
				And("every behaviour is covered", () => {
					expect(run.stdout).toMatch(/behaviour coverage: (\d+)\/\1 \(100%\)/);
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
