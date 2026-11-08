#!/usr/bin/env node
// Static check of the Gherkin corpus under specs/ against its bindings. It fails when a scenario is not bound where it must be, or an exemption is invalid.
// Bindings are read from source text, so no database or browser is needed. The behaviour-*.mjs files beside it are its parts; this file runs them in order.
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readBindings,
	readStepDefinitions,
	stepMatches,
} from "./behaviour-bindings.mjs";
import { checkAlternativeProofs } from "./behaviour-exemptions.mjs";
import { listFiles } from "./behaviour-files.mjs";
import { renderReport } from "./behaviour-report.mjs";
import {
	checkReadmeLink,
	parseFeature,
	readScenarios,
} from "./behaviour-scenarios.mjs";

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

// Checks the whole corpus. Returns the failures, the covered and total behaviour counts, and the report text.
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

// A scenario is bound at unit and at integration by its title, unless it is exempt from integration.
function checkBindings(owner, scenarios, bindings, failures) {
	const names = new Set(scenarios.map((s) => s.name));
	for (const scenario of scenarios) {
		checkScenarioBindings(scenario, bindings, failures);
	}
	checkUnusedBindings(owner, names, bindings, failures);
}

function checkScenarioBindings(scenario, bindings, failures) {
	scenario.bound.unit = bindings.unit.includes(scenario.name);
	if (!scenario.bound.unit) failures.push(`${scenario.name}: no unit binding`);

	if (scenario.exempt.integration) {
		if (bindings.integration.includes(scenario.name)) {
			failures.push(
				`${scenario.name}: bound at integration although @integration-exempt`,
			);
		}
		return;
	}
	scenario.bound.integration = bindings.integration.includes(scenario.name);
	if (!scenario.bound.integration)
		failures.push(`${scenario.name}: no integration binding`);
}

function checkUnusedBindings(owner, names, bindings, failures) {
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
		scenario.bound.e2e = everyStepIsBound(scenario, steps, failures);
	}
	for (const step of steps) {
		if (!step.used)
			failures.push(`unused e2e step ${step.file}: ${step.source}`);
	}
}

// Whether each step of each example row matches a step definition. A step that matches none is a failure.
function everyStepIsBound(scenario, steps, failures) {
	let bound = true;
	for (const row of scenario.rows) {
		for (const raw of scenario.steps) {
			const text = raw.replace(/<([^>]+)>/g, (match, key) => row[key] ?? match);
			const matches = steps.filter((step) => stepMatches(step, text));
			if (matches.length === 0) {
				bound = false;
				failures.push(`${scenario.name}: no e2e step matches "${text}"`);
			}
			for (const step of matches) step.used = true;
		}
	}
	return bound;
}

function isCovered(scenario) {
	const unit = scenario.bound.unit;
	const integration =
		Boolean(scenario.exempt.integration) || scenario.bound.integration;
	const e2e = Boolean(scenario.exempt.e2e) || scenario.bound.e2e;
	return unit && integration && e2e;
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
