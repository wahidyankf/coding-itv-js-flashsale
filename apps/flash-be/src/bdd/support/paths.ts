import path from "node:path";

// Resolves a path under the repository's specs/ tree, from this support folder.
export function specFile(relative: string): string {
	return path.resolve(
		import.meta.dirname,
		"../../../../../specs/apps",
		relative,
	);
}
