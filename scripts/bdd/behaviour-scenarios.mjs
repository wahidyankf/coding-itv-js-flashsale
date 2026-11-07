// Reads the Gherkin corpus for the behaviour checker (check-behaviour-coverage.mjs): each feature file becomes scenarios
// with their tags, steps, example rows and exemptions. It reports what it finds in the files and decides nothing about
// bindings, which the checker does after this.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	AstBuilder,
	GherkinClassicTokenMatcher,
	Parser,
} from "@cucumber/gherkin";
import {
	attachExemptions,
	checkExemptionTags,
	EXEMPT_TAGS,
} from "./behaviour-exemptions.mjs";

// Parses one feature file. A file with no Feature is an error, which the caller reports.
export function parseFeature(source) {
	let id = 0;
	const parser = new Parser(
		new AstBuilder(() => String(++id)),
		new GherkinClassicTokenMatcher(),
	);
	const doc = parser.parse(source);
	if (!doc.feature) throw new Error("file has no Feature");
	return doc;
}

// The scenarios of one parsed feature file, with their exemptions attached. `rel` names the file in each failure.
export function readScenarios(doc, rel, failures) {
	for (const tag of doc.feature.tags) {
		if (tag.name.endsWith("-exempt"))
			failures.push(`${rel}: exemption tag on Feature: ${tag.name}`);
	}
	const scenarios = [];
	collectScenarios(doc.feature.children, rel, [], scenarios, failures);
	attachExemptions(doc, scenarios, rel, failures);
	checkExemptionTags(scenarios, rel, failures);
	return scenarios;
}

// Walks the children of a feature into scenarios. Rule blocks are flattened, and a Background applies to every
// scenario after it.
function collectScenarios(children, rel, background, scenarios, failures) {
	for (const child of children) {
		if (child.background) background.push(...child.background.steps);
		if (child.rule) {
			checkRuleTags(child.rule.tags, rel, failures);
			collectScenarios(
				child.rule.children,
				rel,
				background,
				scenarios,
				failures,
			);
		}
		if (child.scenario)
			scenarios.push(toScenario(child.scenario, rel, background, failures));
	}
}

function checkRuleTags(tags, rel, failures) {
	for (const tag of tags) {
		if (tag.name.endsWith("-exempt"))
			failures.push(`${rel}: exemption tag on Rule: ${tag.name}`);
	}
}

function toScenario(scenario, rel, background, failures) {
	const tags = scenario.tags;
	const tagNames = tags.map((tag) => tag.name.replace(/^@/, ""));
	const exemptLayers = tagNames
		.filter((name) => EXEMPT_TAGS[name])
		.map((name) => EXEMPT_TAGS[name]);
	const rows = rowsOf(scenario);
	if (scenario.examples.length > 0 && rows.length === 0) {
		failures.push(`${rel}: ${scenario.name}: outline has no Examples rows`);
	}
	if (
		scenario.keyword === "Scenario Outline" &&
		scenario.examples.length === 0
	) {
		failures.push(`${rel}: ${scenario.name}: Scenario Outline has no Examples`);
	}
	return {
		file: rel,
		name: scenario.name,
		tagLine: tags.length > 0 ? tags[0].location.line : undefined,
		tagNames,
		exemptLayers,
		exemptionComments: [],
		exempt: {},
		rows: rows.length > 0 ? rows : [{}],
		steps: [
			...background.map((step) => step.text),
			...scenario.steps.map((step) => step.text),
		],
		bound: { unit: false, integration: false, e2e: false },
	};
}

// Each Examples row is one behaviour. A plain scenario is one behaviour with no values.
function rowsOf(scenario) {
	const rows = [];
	for (const examples of scenario.examples) {
		const headers = examples.tableHeader.cells.map((cell) => cell.value);
		for (const body of examples.tableBody) {
			const row = {};
			body.cells.forEach((cell, index) => {
				row[headers[index]] = cell.value;
			});
			rows.push(row);
		}
	}
	return rows;
}

// A feature must be linked from the README of its folder, so a reader finds it.
export function checkReadmeLink(file, rel, failures) {
	return readFile(path.join(path.dirname(file), "README.md"), "utf8").then(
		(readme) => {
			const base = path.basename(file);
			const link = new RegExp(`\\]\\((\\./)?${escapeRegExp(base)}\\)`);
			if (!link.test(readme))
				failures.push(`${rel}: not linked from README.md in its folder`);
		},
		() => failures.push(`${rel}: folder has no README.md`),
	);
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
