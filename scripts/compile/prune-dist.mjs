// Removes build outputs whose source is gone, for build-dist.mjs. tsc overwrites files in place but never deletes, so a
// removed source (an old migration, say) would keep running from its old output. Emptying `dist` first fixes that but
// leaves a gap in which another build, running in parallel, cannot find the library. This keeps `dist` whole at all
// times: it only deletes what the build did not write.
import { globSync, rmSync } from "node:fs";
import path from "node:path";

const EMITTED_PREFIX = "TSFILE: ";

// The files tsc wrote, read from the output of `tsc --listEmittedFiles`, as absolute paths. Other lines are ignored.
export function parseEmittedFiles(output) {
	return output
		.split("\n")
		.filter((line) => line.startsWith(EMITTED_PREFIX))
		.map((line) => path.resolve(line.slice(EMITTED_PREFIX.length).trim()));
}

// Output lines that are not the file list, so tsc's error messages still reach the developer.
export function withoutEmittedFiles(output) {
	return output
		.split("\n")
		.filter((line) => !line.startsWith(EMITTED_PREFIX))
		.join("\n");
}

// Deletes everything under `distDir` that is not one of `emittedFiles` or a folder holding one, and returns what it
// deleted (absolute paths). A missing `distDir` has nothing to delete. Files outside `distDir` are never touched.
export function pruneDist(distDir, emittedFiles) {
	const root = path.resolve(distDir);
	const keep = new Set();
	for (const file of emittedFiles) {
		const relative = path.relative(root, file);
		if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
		let current = file;
		while (current !== root) {
			keep.add(current);
			current = path.dirname(current);
		}
	}
	const removed = [];
	for (const entry of globSync("**", { cwd: root })) {
		const full = path.resolve(root, entry);
		if (full === root || keep.has(full)) continue;
		rmSync(full, { recursive: true, force: true });
		removed.push(full);
	}
	return removed;
}
