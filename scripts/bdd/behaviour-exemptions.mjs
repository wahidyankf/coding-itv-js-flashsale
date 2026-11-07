// The exemptions of the behaviour checker (check-behaviour-coverage.mjs). A scenario may skip a layer's binding if it
// names why, and names a scenario at another layer that proves the same behaviour. The tag says which layer is skipped;
// the comment above the scenario says why and where the proof is.

// The exemption tags, and the layer each one skips.
export const EXEMPT_TAGS = {
	"integration-exempt": "integration",
	"e2e-exempt": "e2e",
};
const EXEMPTION_COMMENT =
	/^# Exemption\((integration|e2e)\): (.+?); alternative-proof: ([a-z][a-z0-9-]*):(unit|integration|e2e) \/ (.+)$/;

// Attaches each `# Exemption(...)` comment to the scenario whose tags follow it. A malformed comment, or one that is not
// directly above a scenario's tags, is a failure.
export function attachExemptions(doc, scenarios, rel, failures) {
	const commentLines = new Set(
		doc.comments.map((comment) => comment.location.line),
	);
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
}

// Checks each scenario's exemption tags against its comments, then records the comment of each exempt layer.
export function checkExemptionTags(scenarios, rel, failures) {
	for (const scenario of scenarios) {
		checkTagNames(scenario, rel, failures);
		checkCommentLayers(scenario, rel, failures);
		bindExemptions(scenario, rel, failures);
	}
}

function checkTagNames(scenario, rel, failures) {
	for (const tagName of scenario.tagNames.filter((name) =>
		name.endsWith("-exempt"),
	)) {
		if (!EXEMPT_TAGS[tagName]) {
			failures.push(
				`${rel}: ${scenario.name}: unknown exemption tag @${tagName}`,
			);
		}
	}
}

function checkCommentLayers(scenario, rel, failures) {
	for (const comment of scenario.exemptionComments) {
		if (!scenario.exemptLayers.includes(comment.layer)) {
			failures.push(
				`${rel}: ${scenario.name}: Exemption(${comment.layer}) comment without @${comment.layer}-exempt tag`,
			);
		}
	}
}

function bindExemptions(scenario, rel, failures) {
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

// An exemption is valid only when its proof is another layer, names a scenario of a known app, and that scenario is bound
// at the proof's layer.
export function checkAlternativeProofs(scenarios, ownerResults, failures) {
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
