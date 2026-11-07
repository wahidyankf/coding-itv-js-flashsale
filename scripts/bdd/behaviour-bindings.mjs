// The bindings the behaviour checker (check-behaviour-coverage.mjs) reads from source text, so it needs no database or
// browser. Unit and integration bindings are the titles of the scenarios that test files name. The e2e bindings are the
// step definitions, because playwright-bdd builds each e2e scenario from its steps.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listFiles } from "./behaviour-files.mjs";

// Captures the title of Scenario and ScenarioOutline calls. Group 3 is a template literal.
const TITLE_CALL =
	/\b(?:Scenario|ScenarioOutline)(?:\.(?:only|skip))?\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`)/g;
// Captures the regex and flags of Given, When, Then, And and But step definitions.
const STEP_CALL =
	/\b(?:Given|When|Then|And|But)\(\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)\s*,/g;
// Captures plain-text step definitions. playwright-bdd matches these by exact text.
const STEP_TEXT_CALL =
	/\b(?:Given|When|Then|And|But)\(\s*(["'])((?:\\.|(?!\1)[^\n\\])*)\1\s*,/g;

// The unit and integration titles one owner binds. A title bound twice, or a dynamic title, is a failure.
export async function readBindings(root, owner, failures) {
	const unit = { titles: [] };
	const integration = { titles: [] };
	const unitFiles = await listFiles(
		path.join(root, owner.unit),
		(file) =>
			/_tests\.(?:tsx?|mjs)$/.test(file) &&
			!/_integration_tests\.(?:tsx?|mjs)$/.test(file),
	);
	const integrationFiles = await listFiles(
		path.join(root, owner.integration),
		(file) => /_integration_tests\.(?:tsx?|mjs)$/.test(file),
	);

	for (const [file, target] of [
		...unitFiles.map((f) => [f, unit]),
		...integrationFiles.map((f) => [f, integration]),
	]) {
		const rel = path.relative(root, file);
		const source = await readFile(file, "utf8");
		titlesIn(source, rel, target, failures);
	}

	reportDuplicates(owner, "unit", unit, failures);
	reportDuplicates(owner, "integration", integration, failures);
	return {
		unit: unit.titles.map((t) => t.title),
		integration: integration.titles.map((t) => t.title),
	};
}

// Adds the literal titles of one test file to `target`. A title built with `${` cannot be read here, so it is a failure.
function titlesIn(source, rel, target, failures) {
	for (const match of source.matchAll(TITLE_CALL)) {
		const [, double, single, template] = match;
		if (template?.includes("${")) {
			failures.push(
				`${rel}: dynamic scenario title "${template}"; use a literal title so the checker can read it`,
			);
			continue;
		}
		target.titles.push({ title: double ?? single ?? template, file: rel });
	}
}

function reportDuplicates(owner, layer, target, failures) {
	const seen = new Map();
	for (const { title } of target.titles)
		seen.set(title, (seen.get(title) ?? 0) + 1);
	for (const [title, count] of seen) {
		if (count > 1)
			failures.push(`${owner.name} ${layer}: duplicate binding "${title}"`);
	}
}

// The e2e step definitions under `dir`. A step is a regex or plain text; the keyword (Given, When, ...) does not matter
// for matching.
export async function readStepDefinitions(dir) {
	const files = await listFiles(dir, (file) => file.endsWith(".ts"));
	const steps = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(STEP_CALL)) {
			const [, pattern, flags] = match;
			steps.push({
				source: `/${pattern}/${flags}`,
				re: new RegExp(pattern, flags),
				text: null,
				file: path.basename(file),
				used: false,
			});
		}
		for (const match of source.matchAll(STEP_TEXT_CALL)) {
			const [, , text] = match;
			steps.push({
				source: `"${text}"`,
				re: null,
				text: text.replace(/\\(.)/g, "$1"),
				file: path.basename(file),
				used: false,
			});
		}
	}
	return steps;
}

// Whether a step definition matches the text of a step.
export function stepMatches(step, text) {
	return step.re ? step.re.test(text) : step.text === text;
}
