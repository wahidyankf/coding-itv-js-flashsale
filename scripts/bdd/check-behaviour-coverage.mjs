#!/usr/bin/env node
// Static check of the Gherkin corpus under specs/ against its bindings.
// It fails when a scenario is not bound at a layer it must be bound at, or when an exemption is invalid.
// Bindings are read from source text, so the check is fast and needs no database or browser.
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AstBuilder,
	GherkinClassicTokenMatcher,
	Parser,
} from "@cucumber/gherkin";

// Each owner maps one spec folder to the binding folders that must implement it.
export const OWNERS = [
	{
		name: "flash-be",
		spec: "specs/apps/flash/be",
		unit: "apps/flash-be/src/bdd",
		integration: "apps/flash-be/src/bdd",
		e2e: "apps/flash-be-e2e/steps",
	},
	{
		name: "flash-web",
		spec: "specs/apps/flash/web",
		unit: "apps/flash-web/src/bdd",
		integration: "apps/flash-web/src/bdd",
		e2e: "apps/flash-web-e2e/steps",
	},
];

const EXEMPT_TAGS = {
	"integration-exempt": "integration",
	"e2e-exempt": "e2e",
};
const EXEMPTION_COMMENT =
	/^# Exemption\((integration|e2e)\): (.+?); alternative-proof: ([a-z][a-z0-9-]*):(unit|integration|e2e) \/ (.+)$/;
// Captures the title of Scenario and ScenarioOutline calls. Group 3 is a template literal.
const TITLE_CALL =
	/\b(?:Scenario|ScenarioOutline)(?:\.(?:only|skip))?\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`)/g;
// Captures the regex and flags of Given, When, Then, And and But step definitions.
const STEP_CALL =
	/\b(?:Given|When|Then|And|But)\(\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)\s*,/g;
// Captures plain-text step definitions. playwright-bdd matches these by exact text.
const STEP_TEXT_CALL =
	/\b(?:Given|When|Then|And|But)\(\s*(["'])((?:\\.|(?!\1)[^\n\\])*)\1\s*,/g;

export async function checkCorpus({ root, owners = OWNERS }) {
	const failures = [];
	const ownerResults = [];

	for (const owner of owners) {
		const scenarios = [];
		const featureFiles = await listFiles(path.join(root, owner.spec), (file) =>
			file.endsWith(".feature"),
		);

		for (const file of featureFiles) {
			const rel = path.relative(root, file);
			const source = await readFile(file, "utf8");
			let doc;
			try {
				doc = parseFeature(source);
			} catch (error) {
				failures.push(`${rel}: ${firstLine(error)}`);
				continue;
			}
			scenarios.push(...readScenarios(doc, rel, failures));
			await checkReadmeLink(file, rel, failures);
		}

		const bindings = await readBindings(root, owner, failures);
		const steps = await readStepDefinitions(path.join(root, owner.e2e));
		ownerResults.push({ owner, scenarios, bindings, steps });
	}

	// Checks that need every owner's scenarios come after the per-owner pass.
	for (const { owner, scenarios, bindings, steps } of ownerResults) {
		checkUniqueNames(owner, scenarios, failures);
		checkBindings(owner, scenarios, bindings, failures);
		checkE2e(scenarios, steps, failures);
	}
	for (const { scenarios } of ownerResults) {
		checkAlternativeProofs(scenarios, ownerResults, failures);
	}

	const allScenarios = ownerResults.flatMap((result) =>
		result.scenarios.map((s) => ({ ...s, owner: result.owner.name })),
	);
	const total = allScenarios.reduce((sum, s) => sum + s.rows.length, 0);
	const covered = allScenarios.reduce(
		(sum, s) => sum + (isCovered(s) ? s.rows.length : 0),
		0,
	);

	return {
		failures,
		total,
		covered,
		report: renderReport(allScenarios, failures, covered, total),
	};
}

function parseFeature(source) {
	let id = 0;
	const parser = new Parser(
		new AstBuilder(() => String(++id)),
		new GherkinClassicTokenMatcher(),
	);
	const doc = parser.parse(source);
	if (!doc.feature) throw new Error("file has no Feature");
	return doc;
}

// Flattens Rule blocks and records each scenario with its tags, steps, rows and exemptions.
function readScenarios(doc, rel, failures) {
	const commentLines = new Set(
		doc.comments.map((comment) => comment.location.line),
	);
	const scenarios = [];
	const background = [];

	for (const tag of doc.feature.tags) {
		if (tag.name.endsWith("-exempt"))
			failures.push(`${rel}: exemption tag on Feature: ${tag.name}`);
	}

	const walk = (children) => {
		for (const child of children) {
			if (child.background) background.push(...child.background.steps);
			if (child.rule) {
				for (const tag of child.rule.tags) {
					if (tag.name.endsWith("-exempt"))
						failures.push(`${rel}: exemption tag on Rule: ${tag.name}`);
				}
				walk(child.rule.children);
			}
			if (child.scenario)
				scenarios.push(toScenario(child.scenario, rel, background, failures));
		}
	};
	walk(doc.feature.children);

	// Each Examples row is one behaviour. A plain scenario is one behaviour with no values.
	const exemptionComments = doc.comments
		.map((comment) => ({ comment, text: comment.text.trim() }))
		.filter(({ text }) => text.startsWith("# Exemption("));

	for (const { comment, text } of exemptionComments) {
		const line = comment.location.line;
		const match = EXEMPTION_COMMENT.exec(text);
		if (!match) {
			failures.push(
				`${rel}:${line}: malformed exemption comment; expected "# Exemption(<layer>): <reason>; alternative-proof: <app>:<layer> / <scenario>"`,
			);
			continue;
		}
		const [, layer, reason, app, proofLayer, proofScenario] = match;
		let target = line + 1;
		while (commentLines.has(target)) target++;
		const owner = scenarios.find((s) => s.tagLine === target);
		if (!owner) {
			failures.push(
				`${rel}:${line}: exemption is not directly above a scenario's tags`,
			);
			continue;
		}
		owner.exemptionComments.push({
			layer,
			reason,
			app,
			proofLayer,
			proofScenario,
			line,
		});
	}

	for (const scenario of scenarios) {
		for (const tagName of scenario.tagNames.filter((name) =>
			name.endsWith("-exempt"),
		)) {
			if (!EXEMPT_TAGS[tagName])
				failures.push(
					`${rel}: ${scenario.name}: unknown exemption tag @${tagName}`,
				);
		}
		for (const comment of scenario.exemptionComments) {
			if (!scenario.exemptLayers.includes(comment.layer)) {
				failures.push(
					`${rel}: ${scenario.name}: Exemption(${comment.layer}) comment without @${comment.layer}-exempt tag`,
				);
			}
		}
		for (const layer of scenario.exemptLayers) {
			const comment = scenario.exemptionComments.find((c) => c.layer === layer);
			if (!comment) {
				failures.push(
					`${rel}: ${scenario.name}: missing Exemption(${layer}) comment`,
				);
				continue;
			}
			scenario.exempt[layer] = comment;
		}
	}

	return scenarios;
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

function checkReadmeLink(file, rel, failures) {
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

async function readBindings(root, owner, failures) {
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

	for (const [layer, target] of [
		["unit", unit],
		["integration", integration],
	]) {
		const seen = new Map();
		for (const { title } of target.titles)
			seen.set(title, (seen.get(title) ?? 0) + 1);
		for (const [title, count] of seen) {
			if (count > 1)
				failures.push(`${owner.name} ${layer}: duplicate binding "${title}"`);
		}
	}
	return {
		unit: unit.titles.map((t) => t.title),
		integration: integration.titles.map((t) => t.title),
	};
}

// A step definition is a regex or plain text. The keyword (Given, When, ...) does not matter for matching.
async function readStepDefinitions(dir) {
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

function stepMatches(step, text) {
	return step.re ? step.re.test(text) : step.text === text;
}

function checkUniqueNames(owner, scenarios, failures) {
	const seen = new Set();
	for (const scenario of scenarios) {
		if (seen.has(scenario.name))
			failures.push(
				`${owner.name}: duplicate scenario name "${scenario.name}"`,
			);
		seen.add(scenario.name);
	}
}

function checkBindings(owner, scenarios, bindings, failures) {
	const names = new Set(scenarios.map((s) => s.name));

	for (const scenario of scenarios) {
		scenario.bound.unit = bindings.unit.includes(scenario.name);
		if (!scenario.bound.unit)
			failures.push(`${scenario.name}: no unit binding`);

		if (scenario.exempt.integration) {
			if (bindings.integration.includes(scenario.name)) {
				failures.push(
					`${scenario.name}: bound at integration although @integration-exempt`,
				);
			}
		} else {
			scenario.bound.integration = bindings.integration.includes(scenario.name);
			if (!scenario.bound.integration)
				failures.push(`${scenario.name}: no integration binding`);
		}
	}

	for (const title of bindings.unit) {
		if (!names.has(title))
			failures.push(`${owner.name} unit: unused unit binding: ${title}`);
	}
	for (const title of bindings.integration) {
		if (!names.has(title))
			failures.push(
				`${owner.name} integration: unused integration binding: ${title}`,
			);
	}
}

// e2e has no per-scenario binding: playwright-bdd builds each scenario from its steps.
// A scenario is bound at e2e when every one of its steps matches a step definition.
function checkE2e(scenarios, steps, failures) {
	for (const scenario of scenarios) {
		if (scenario.exempt.e2e) continue;
		let bound = true;
		for (const row of scenario.rows) {
			for (const raw of scenario.steps) {
				const text = raw.replace(
					/<([^>]+)>/g,
					(match, key) => row[key] ?? match,
				);
				const matches = steps.filter((step) => stepMatches(step, text));
				if (matches.length === 0) {
					bound = false;
					failures.push(`${scenario.name}: no e2e step matches "${text}"`);
				}
				for (const step of matches) step.used = true;
			}
		}
		scenario.bound.e2e = bound;
	}
	for (const step of steps) {
		if (!step.used)
			failures.push(`unused e2e step ${step.file}: ${step.source}`);
	}
}

function checkAlternativeProofs(scenarios, ownerResults, failures) {
	for (const scenario of scenarios) {
		for (const [layer, comment] of Object.entries(scenario.exempt)) {
			if (comment.proofLayer === layer) {
				failures.push(
					`${scenario.name}: alternative-proof must name a different layer than ${layer}`,
				);
				continue;
			}
			const proofOwner = ownerResults.find(
				(result) => result.owner.name === comment.app,
			);
			if (!proofOwner) {
				failures.push(
					`${scenario.name}: alternative-proof app not found: ${comment.app}`,
				);
				continue;
			}
			const target = proofOwner.scenarios.find(
				(s) => s.name === comment.proofScenario,
			);
			if (!target) {
				failures.push(
					`${scenario.name}: alternative-proof scenario not found: ${comment.proofScenario}`,
				);
				continue;
			}
			if (!target.bound[comment.proofLayer]) {
				failures.push(
					`${scenario.name}: alternative-proof ${comment.app}:${comment.proofLayer} / ${comment.proofScenario} is not bound at that layer`,
				);
			}
		}
	}
}

function isCovered(scenario) {
	const unit = scenario.bound.unit;
	const integration =
		Boolean(scenario.exempt.integration) || scenario.bound.integration;
	const e2e = Boolean(scenario.exempt.e2e) || scenario.bound.e2e;
	return unit && integration && e2e;
}

function renderReport(scenarios, failures, covered, total) {
	const pct = total === 0 ? 100 : Math.round((covered / total) * 100);
	const lines = [
		"# Behaviour status",
		"",
		"Generated by `npm run bdd:check`. Do not edit; run the check again instead.",
		"",
		`Behaviour coverage: ${covered}/${total} (${pct}%)`,
		"",
		"| Owner | Feature | Scenario | Rows | Unit | Integration | E2E |",
		"| --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const scenario of scenarios) {
		const integration = scenario.exempt.integration
			? "exempt"
			: scenario.bound.integration
				? "bound"
				: "missing";
		const e2e = scenario.exempt.e2e
			? "exempt"
			: scenario.bound.e2e
				? "bound"
				: "missing";
		const unit = scenario.bound.unit ? "bound" : "missing";
		lines.push(
			`| ${scenario.owner} | ${scenario.file} | ${scenario.name} | ${scenario.rows.length} | ${unit} | ${integration} | ${e2e} |`,
		);
	}
	if (failures.length > 0) {
		lines.push("", "## Failures", "");
		for (const failure of failures) lines.push(`- ${failure}`);
	}
	return `${lines.join("\n")}\n`;
}

async function listFiles(dir, keep) {
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

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstLine(error) {
	return String(error.message ?? error).split("\n")[0];
}

async function main() {
	const args = process.argv.slice(2);
	const rootIndex = args.indexOf("--root");
	const root =
		rootIndex >= 0
			? path.resolve(args[rootIndex + 1])
			: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

	const result = await checkCorpus({ root });
	const reportDir = path.join(root, "generated-reports");
	await mkdir(reportDir, { recursive: true });
	await writeFile(path.join(reportDir, "behaviour-status.md"), result.report);

	for (const failure of result.failures) console.error(`bdd:check: ${failure}`);
	const pct =
		result.total === 0
			? 100
			: Math.round((result.covered / result.total) * 100);
	console.log(
		`behaviour coverage: ${result.covered}/${result.total} (${pct}%)`,
	);
	if (result.failures.length > 0) process.exitCode = 1;
}

// Compare real paths: on macOS the temp dir is a symlink, and Node reports the resolved module URL.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
