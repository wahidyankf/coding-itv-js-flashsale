// Product code must not write the API down a second time. A path of the API, such as "/sales/...", or the ticket header
// is read from @flash/contract. This finds the places that do not.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The folders whose files build requests or read replies. Tests, the BDD helpers and generated files are left out:
// they may state a path to prove what the contract says.
const ROOTS = [
	"apps/flash-be/src",
	"apps/flash-web/src",
	"apps/flash-be-e2e/steps",
	"apps/flash-web-e2e/steps",
	"apps/flash-load/k6",
];

const SKIPPED_DIRECTORIES = new Set([
	"node_modules",
	"bdd",
	".bundle",
	".output",
	"dist",
]);
const SKIPPED_FILES = [
	/_tests\.tsx?$/,
	/_integration_tests\.tsx?$/,
	/\.gen\.ts$/,
	// A route of the web server itself, not a route of the API.
	/routes[\\/]api[\\/]sales\.\$\.ts$/,
];

// A string or template literal that holds an API path, or the ticket header name.
const HAND_WRITTEN = /["'`][^"'`\n]*\/sales(?:[/"'`]|$)|x-queue-ticket/i;

export function violationsIn(text) {
	return text
		.split("\n")
		.map((line, index) => ({ line: index + 1, text: line.trim() }))
		.filter(({ text: line }) => !line.startsWith("//") && !line.startsWith("*"))
		.filter(({ text: line }) => HAND_WRITTEN.test(line));
}

function* sourceFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* sourceFiles(full);
		} else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!SKIPPED_FILES.some((skipped) => skipped.test(full))
		) {
			yield full;
		}
	}
}

export function findViolations(root = ".") {
	const found = [];
	for (const folder of ROOTS) {
		for (const file of sourceFiles(path.join(root, folder))) {
			for (const hit of violationsIn(readFileSync(file, "utf8"))) {
				found.push({ file: path.relative(root, file), ...hit });
			}
		}
	}
	return found;
}
