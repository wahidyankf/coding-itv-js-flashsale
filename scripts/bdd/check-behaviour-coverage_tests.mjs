import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCorpus } from "./check-behaviour-coverage.mjs";
import { CORPORA, DEFECTS } from "./support/defects.mjs";
import { FLASH_OWNERS } from "./support/fixtures.mjs";
import { DEFECT_PROBLEMS } from "./support/problems.mjs";

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

describe("behaviour check rules", () => {
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

	it("The check passes on the real repository", async () => {
		const result = await checkCorpus({ root: REPO_ROOT });
		expect(result.failures).toEqual([]);
		expect(result.total).toBeGreaterThan(0);
		expect(result.covered).toBe(result.total);
	});
});
