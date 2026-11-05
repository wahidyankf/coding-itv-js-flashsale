// Reads one run of the checker command. Each failure is a line on stderr with the "bdd:check: " prefix.
// The exit code must agree with those failures, so a broken command cannot pass as a clean run.
export function outcomeOf(run) {
	const prefix = "bdd:check: ";
	const failures = run.stderr
		.split("\n")
		.filter((line) => line.startsWith(prefix))
		.map((line) => line.slice(prefix.length));
	const summary = /behaviour coverage: (\d+)\/(\d+)/.exec(run.stdout);
	if (!summary) throw new Error(`no coverage summary; stderr: ${run.stderr}`);
	const expected = failures.length > 0 ? 1 : 0;
	if (run.status !== expected) {
		throw new Error(
			`exit ${run.status} disagrees with ${failures.length} failures`,
		);
	}
	return {
		status: run.status,
		failures,
		covered: Number(summary[1]),
		total: Number(summary[2]),
	};
}
