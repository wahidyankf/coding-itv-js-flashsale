// Lists files under a folder for the behaviour checker (check-behaviour-coverage.mjs). A folder that does not exist has
// no files, so a new owner with no bindings yet is reported as missing them rather than crashing the check.
import { readdir } from "node:fs/promises";
import path from "node:path";

// The files under `dir` that `keep` accepts, sorted, with subfolders included.
export async function listFiles(dir, keep) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(full, keep)));
		else if (keep(full)) files.push(full);
	}
	return files.sort();
}
