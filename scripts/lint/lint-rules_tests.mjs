import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const FEATURE = path.join(
	REPO_ROOT,
	"specs/tooling/lint-rules/behaviours/product-code.feature",
);
const BIOME = path.join(REPO_ROOT, "node_modules/.bin/biome");

// The rules come from the repo's own biome.json, so this test follows the real configuration. Only the file scope
// changes: the sample sits in a temp folder, so the product-code override applies to every file there.
const base = JSON.parse(
	readFileSync(path.join(REPO_ROOT, "biome.json"), "utf8"),
);
const productOverride = base.overrides.find((entry) => entry.plugins?.length);

const folders = [];
afterAll(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

// Runs the linter on a sample and returns the exit status and what it printed.
function lint(source) {
	const folder = mkdtempSync(path.join(tmpdir(), "lint-rules-"));
	folders.push(folder);
	const config = {
		linter: base.linter,
		javascript: base.javascript,
		overrides: [
			{
				includes: ["**"],
				plugins: productOverride.plugins.map((plugin) =>
					path.resolve(REPO_ROOT, plugin),
				),
			},
		],
	};
	writeFileSync(path.join(folder, "biome.json"), JSON.stringify(config));
	writeFileSync(path.join(folder, "sample.ts"), source);
	const run = spawnSync(BIOME, ["lint", "sample.ts"], {
		cwd: folder,
		encoding: "utf8",
	});
	return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const CATCH = `export function read(): number {
	try {
		return JSON.parse("1") as number;
	} catch {
		return 0;
	}
}
`;

const PROMISE_CATCH = `export const later = Promise.resolve(1).catch(() => 0);
`;

const FINALLY_ONLY = `export function read(): number {
	try {
		return JSON.parse("1") as number;
	} finally {
		console.log("done");
	}
}
`;

const SWITCH = (cases) => `type Light = "red" | "amber" | "green";

export function describe(light: Light): string {
	switch (light) {
${cases}
	}
}
`;

const TWO_OF_THREE = SWITCH(
	`		case "red":
			return "stop";
		case "amber":
			return "slow";`,
);

const ALL_THREE = SWITCH(
	`		case "red":
			return "stop";
		case "amber":
			return "slow";
		case "green":
			return "go";`,
);

describeFeature(await loadFeature(FEATURE), ({ Scenario }) => {
	Scenario(
		"A catch clause in product code is an error",
		({ Given, When, Then, And }) => {
			let outcome;
			let source = "";
			Given("product code with a try block and a catch clause", () => {
				source = CATCH;
			});
			When("the linter runs on it", () => {
				outcome = lint(source);
			});
			Then("the run fails", () => {
				expect(outcome.status).not.toBe(0);
			});
			And(
				"the message tells the author to return a Result with attempt",
				() => {
					expect(outcome.output).toContain("Return a Result with attempt");
				},
			);
		},
	);

	Scenario(
		"A promise catch call in product code is an error",
		({ Given, When, Then, And }) => {
			let outcome;
			let source = "";
			Given("product code that calls .catch on a promise", () => {
				source = PROMISE_CATCH;
			});
			When("the linter runs on it", () => {
				outcome = lint(source);
			});
			Then("the run fails", () => {
				expect(outcome.status).not.toBe(0);
			});
			And("the message tells the author to use attemptAsync", () => {
				expect(outcome.output).toContain("Use attemptAsync");
			});
		},
	);

	Scenario(
		"A try block with finally and no catch is allowed",
		({ Given, When, Then }) => {
			let outcome;
			let source = "";
			Given("product code with a try block and a finally clause only", () => {
				source = FINALLY_ONLY;
			});
			When("the linter runs on it", () => {
				outcome = lint(source);
			});
			Then("the run passes", () => {
				expect(outcome.output).not.toContain("Do not catch");
				expect(outcome.status).toBe(0);
			});
		},
	);

	Scenario(
		"A switch that forgets a case of a union is an error",
		({ Given, When, Then, And }) => {
			let outcome;
			let source = "";
			Given(
				"product code with a switch over a union that handles two of three cases",
				() => {
					source = TWO_OF_THREE;
				},
			);
			When("the linter runs on it", () => {
				outcome = lint(source);
			});
			Then("the run fails", () => {
				expect(outcome.status).not.toBe(0);
			});
			And("the message says the switch is not exhaustive", () => {
				expect(outcome.output).toContain("not exhaustive");
			});
		},
	);

	Scenario(
		"A switch that handles every case of a union is allowed",
		({ Given, When, Then }) => {
			let outcome;
			let source = "";
			Given(
				"product code with a switch over a union that handles all three cases",
				() => {
					source = ALL_THREE;
				},
			);
			When("the linter runs on it", () => {
				outcome = lint(source);
			});
			Then("the run passes", () => {
				expect(outcome.status).toBe(0);
			});
		},
	);
});
