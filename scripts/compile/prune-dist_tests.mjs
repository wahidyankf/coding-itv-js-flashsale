// Tests of prune-dist.mjs and build-dist.mjs: stale outputs go, current outputs stay, and dist is never emptied.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	parseEmittedFiles,
	pruneDist,
	withoutEmittedFiles,
} from "./prune-dist.mjs";

const BUILD_SCRIPT = path.join(import.meta.dirname, "build-dist.mjs");
const folders = [];
afterAll(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

// A temp folder with the given files (relative path to content).
function project(files) {
	const root = mkdtempSync(path.join(tmpdir(), "build-dist-"));
	folders.push(root);
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		writeFileSync(path.join(root, name), content);
	}
	return root;
}

describe("parseEmittedFiles", () => {
	it("reads the TSFILE lines as absolute paths and ignores the rest", () => {
		const output =
			"TSFILE: /a/dist/x.js\nsrc/y.ts(1,1): error TS1\nTSFILE: /a/dist/x.d.ts\n";
		expect(parseEmittedFiles(output)).toEqual([
			"/a/dist/x.js",
			"/a/dist/x.d.ts",
		]);
	});
});

describe("withoutEmittedFiles", () => {
	it("keeps the lines that are not file names", () => {
		expect(withoutEmittedFiles("TSFILE: /a.js\nerror TS1\n")).toBe(
			"error TS1\n",
		);
	});
});

describe("pruneDist", () => {
	it("deletes an output that was not written, with its empty folder", () => {
		const root = project({
			"dist/keep.js": "",
			"dist/sub/keep.js": "",
			"dist/old/0001_old.js": "",
			"dist/sub/stray.d.ts": "",
		});
		const dist = path.join(root, "dist");
		const removed = pruneDist(dist, [
			path.join(dist, "keep.js"),
			path.join(dist, "sub/keep.js"),
		]);
		expect(existsSync(path.join(dist, "keep.js"))).toBe(true);
		expect(existsSync(path.join(dist, "sub/keep.js"))).toBe(true);
		expect(existsSync(path.join(dist, "old"))).toBe(false);
		expect(existsSync(path.join(dist, "sub/stray.d.ts"))).toBe(false);
		expect(removed).toHaveLength(3);
	});

	it("leaves everything alone when every file was written", () => {
		const root = project({ "dist/a.js": "", "dist/b/c.js": "" });
		const dist = path.join(root, "dist");
		const removed = pruneDist(dist, [
			path.join(dist, "a.js"),
			path.join(dist, "b/c.js"),
		]);
		expect(removed).toEqual([]);
		expect(existsSync(path.join(dist, "b/c.js"))).toBe(true);
	});

	it("does nothing when dist does not exist", () => {
		const root = project({});
		expect(pruneDist(path.join(root, "dist"), [])).toEqual([]);
	});

	it("never deletes a file outside dist", () => {
		const root = project({ "dist/a.js": "", "other/b.js": "" });
		pruneDist(path.join(root, "dist"), [path.join(root, "other/b.js")]);
		expect(existsSync(path.join(root, "other/b.js"))).toBe(true);
		expect(existsSync(path.join(root, "dist/a.js"))).toBe(false);
	});
});

describe("build-dist.mjs", () => {
	const tsconfig = JSON.stringify({
		compilerOptions: {
			target: "es2022",
			module: "nodenext",
			outDir: "dist",
			rootDir: "src",
			skipLibCheck: true,
		},
		include: ["src/**/*.ts"],
	});

	// Runs the build script in a sample package and returns the status.
	function build(root) {
		return spawnSync(process.execPath, [BUILD_SCRIPT], {
			cwd: root,
			encoding: "utf8",
		});
	}

	it("removes an orphan output and keeps the current ones", () => {
		const root = project({
			"tsconfig.build.json": tsconfig,
			"src/index.ts": "export const one = 1;\n",
			"dist/old/0001_gone.js": "",
			"dist/gone.js": "",
		});
		const result = build(root);
		expect(result.status).toBe(0);
		expect(existsSync(path.join(root, "dist/index.js"))).toBe(true);
		expect(existsSync(path.join(root, "dist/gone.js"))).toBe(false);
		expect(existsSync(path.join(root, "dist/old"))).toBe(false);
	});

	it("fails on a type error and prunes nothing", () => {
		const root = project({
			"tsconfig.build.json": tsconfig,
			"src/index.ts": "export const one: string = 1;\n",
			"dist/gone.js": "",
		});
		const result = build(root);
		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain("TS2322");
		expect(existsSync(path.join(root, "dist/gone.js"))).toBe(true);
	});
});
