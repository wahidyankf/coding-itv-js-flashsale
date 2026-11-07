import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORPORA, DEFECTS } from "./support/defects.mjs";
import { PATHS } from "./support/fixtures.mjs";
import { outcomeOf } from "./support/outcome.mjs";
import { DEFECT_PROBLEMS } from "./support/problems.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CHECKER = path.join(
	REPO_ROOT,
	"scripts/bdd/check-behaviour-coverage.mjs",
);

// Runs a copy of the checker the way the repository ships it: a copy at scripts/bdd, the default root, and the exit
// code. Each file of the corpus is written into a temp tree, and a null value leaves the file out.
async function runShipped(files) {
	const tree = await mkdtemp(path.join(tmpdir(), "bdd-shipped-"));
	try {
		// The checker is several modules that import each other, so the whole folder is copied.
		await cp(path.dirname(CHECKER), path.join(tree, "scripts/bdd"), {
			recursive: true,
		});
		await symlink(
			path.join(REPO_ROOT, "node_modules"),
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
				{
					cwd: tree,
					encoding: "utf8",
				},
			),
		);
	} finally {
		await rm(tree, { recursive: true, force: true });
	}
}

describe("behaviour check as shipped", () => {
	it.each(DEFECT_PROBLEMS)(
		"rejects a corpus with %s, naming the problem",
		async (defect, problem) => {
			const result = await runShipped(DEFECTS[defect]());
			expect(result.status).toBe(1);
			expect(result.failures.join("\n")).toContain(problem);
		},
	);

	it("A corpus bound at every layer passes", async () => {
		const result = await runShipped(CORPORA["bound at every layer"]());
		expect(result.failures).toEqual([]);
		expect(result.covered).toBe(1);
	});

	it("A plain-text e2e step matches its text exactly", async () => {
		const result = await runShipped(CORPORA["plain-text e2e steps"]());
		expect(result.failures.join("\n")).not.toContain("no e2e step matches");
	});

	it("An exemption with a valid comment and alternative proof passes", async () => {
		const files = { ...CORPORA["valid exemption"](), [PATHS.e2e]: null };
		const result = await runShipped(files);
		expect(result.failures).toEqual([]);
		expect(result.covered).toBe(1);
	});

	it("An outline counts each Examples row as one behaviour", async () => {
		const result = await runShipped(CORPORA["outline with two rows"]());
		expect(result.failures).toEqual([]);
		expect(result.total).toBe(2);
		expect(result.covered).toBe(2);
	});
});
