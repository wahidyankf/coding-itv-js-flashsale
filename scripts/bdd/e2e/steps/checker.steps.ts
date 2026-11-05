import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { CORPORA, DEFECTS } from "../../support/defects.mjs";
import { PATHS } from "../../support/fixtures.mjs";
import { outcomeOf } from "../../support/outcome.mjs";

// The bdd:e2e script runs from scripts/bdd/e2e, so the repository is three levels up.
const REPO = path.resolve(process.cwd(), "../../..");
const CHECKER = path.join(REPO, "scripts/bdd/check-behaviour-coverage.mjs");

type Corpus = Record<string, string | null>;
type Outcome = ReturnType<typeof outcomeOf>;

// Scenarios run one at a time, and every Given starts a fresh corpus, so this state is safe to share.
let corpus: Corpus = {};
let repository = false;
let outcome: Outcome | undefined;

const { Given, When, Then } = createBdd();

function start(next: Corpus) {
	corpus = next;
	repository = false;
}

function current(): Outcome {
	if (!outcome) throw new Error("the behaviour check has not run");
	return outcome;
}

// Runs the checker the way the repository ships it: a copy at scripts/bdd, the default root, and the exit code.
async function runShipped(files: Corpus): Promise<Outcome> {
	const tree = await mkdtemp(path.join(tmpdir(), "bdd-e2e-"));
	try {
		await mkdir(path.join(tree, "scripts/bdd"), { recursive: true });
		await cp(
			CHECKER,
			path.join(tree, "scripts/bdd/check-behaviour-coverage.mjs"),
		);
		await symlink(
			path.join(REPO, "node_modules"),
			path.join(tree, "node_modules"),
			"dir",
		);
		for (const [rel, text] of Object.entries(files)) {
			if (text === null) continue;
			await mkdir(path.dirname(path.join(tree, rel)), { recursive: true });
			await writeFile(path.join(tree, rel), text);
		}
		return outcomeOf(
			spawnSync(
				process.execPath,
				[path.join(tree, "scripts/bdd/check-behaviour-coverage.mjs")],
				{ cwd: tree, encoding: "utf8" },
			),
		);
	} finally {
		await rm(tree, { recursive: true, force: true });
	}
}

// Runs the repository's own entry point, the same command the pre-push hook runs.
function runRepository(): Outcome {
	return outcomeOf(
		spawnSync("npm", ["run", "--silent", "bdd:check"], {
			cwd: REPO,
			encoding: "utf8",
		}),
	);
}

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given(/^the corpus has the defect (.+)$/, async ({}, defect: string) => {
	start(DEFECTS[defect]());
});

Given("the corpus binds every scenario at every layer", () => {
	start(CORPORA["bound at every layer"]());
});

Given("the e2e steps define each step as plain text", () => {
	start(CORPORA["plain-text e2e steps"]());
});

Given(
	"the scenario is e2e-exempt with a valid comment and alternative proof",
	() => {
		start(CORPORA["valid exemption"]());
	},
);

Given(
	"the corpus has an outline with two Examples rows, bound at every layer",
	() => {
		start(CORPORA["outline with two rows"]());
	},
);

Given("the repository's own corpus", () => {
	start({});
	repository = true;
});

Given("the e2e steps are absent", () => {
	corpus = { ...corpus, [PATHS.e2e]: null };
});

When("the behaviour check runs", async () => {
	outcome = repository ? runRepository() : await runShipped(corpus);
});

Then("the check reports failures", () => {
	expect(current().status).toBe(1);
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the failures name (.+)$/, async ({}, problem: string) => {
	expect(current().failures.join("\n")).toContain(problem);
});

Then("the check reports no failures", () => {
	expect(current().failures).toEqual([]);
});

Then("the failures are empty", () => {
	expect(current().failures).toEqual([]);
});

Then("the failures do not name a missing e2e step", () => {
	expect(current().failures.join("\n")).not.toContain("no e2e step matches");
});

Then("one behaviour of one is covered", () => {
	expect(current().total).toBe(1);
	expect(current().covered).toBe(1);
});

Then("two behaviours are counted", () => {
	expect(current().total).toBe(2);
});

Then("both behaviours are covered", () => {
	expect(current().covered).toBe(2);
});

Then("every behaviour is covered", () => {
	expect(current().total).toBeGreaterThan(0);
	expect(current().covered).toBe(current().total);
});
