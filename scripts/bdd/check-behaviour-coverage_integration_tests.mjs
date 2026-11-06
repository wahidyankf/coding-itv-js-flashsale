import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CORPORA, DEFECTS } from "./support/defects.mjs";
import { outcomeOf } from "./support/outcome.mjs";
import { DEFECT_PROBLEMS } from "./support/problems.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO_ROOT, "scripts/bdd/check-behaviour-coverage.mjs");

const roots = [];

afterAll(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

// Runs the command as a separate process on a temp corpus, passed with --root.
async function corpus(files) {
	const root = await mkdtemp(path.join(tmpdir(), "bdd-check-"));
	roots.push(root);
	for (const [rel, text] of Object.entries(files)) {
		if (text === null) continue;
		const abs = path.join(root, rel);
		await mkdir(path.dirname(abs), { recursive: true });
		await writeFile(abs, text);
	}
	return outcomeOf(
		spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8" }),
	);
}

describe("behaviour check as a separate process", () => {
	it.each(DEFECT_PROBLEMS)(
		"The check rejects a corpus with %s",
		async (defect, problem) => {
			const result = await corpus(DEFECTS[defect]());
			expect(result.failures.length).toBeGreaterThan(0);
			expect(result.failures.join("\n")).toContain(problem);
		},
	);

	it("A corpus bound at every layer passes", async () => {
		const result = await corpus(CORPORA["bound at every layer"]());
		expect(result.failures).toEqual([]);
		expect(result.total).toBe(1);
		expect(result.covered).toBe(1);
	});

	it("A plain-text e2e step matches its text exactly", async () => {
		const result = await corpus(CORPORA["plain-text e2e steps"]());
		expect(result.failures.join("\n")).not.toContain("no e2e step matches");
	});

	it("An exemption with a valid comment and alternative proof passes", async () => {
		const files = {
			...CORPORA["valid exemption"](),
			"apps/flash-be-e2e/steps/be.steps.ts": null,
		};
		const result = await corpus(files);
		expect(result.failures).toEqual([]);
		expect(result.covered).toBe(1);
	});

	it("An outline counts each Examples row as one behaviour", async () => {
		const result = await corpus(CORPORA["outline with two rows"]());
		expect(result.failures).toEqual([]);
		expect(result.total).toBe(2);
		expect(result.covered).toBe(2);
	});

	it("The check passes on the real repository", () => {
		const run = spawnSync(process.execPath, [CLI], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		expect(run.status, run.stderr).toBe(0);
		expect(run.stdout).toMatch(/behaviour coverage: (\d+)\/\1 \(100%\)/);
	});
});
