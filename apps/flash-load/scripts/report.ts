// The report of one run: `<profile>.md` in generated-reports/load, printed to the console too. It shows the verdict table,
// the chaos events and the numbers shown for information only. Part of the load runner in scripts/; it is written after the facts are judged.
import { writeFileSync } from "node:fs";
import type { Profile, ProfileName } from "../k6/profiles.ts";
import type { K6Facts } from "./collect.ts";
import { reportPath } from "./compose.ts";
import type { Sample } from "./sampler.ts";
import { formatMs, type Row } from "./verdict.ts";

// What the report needs from a finished run. The report shows these facts and judges none of them; the verdict rows are
// the judgement.
export type ReportInput = {
	name: ProfileName;
	profile: Profile;
	saleId: string;
	stock: number;
	// What the chaos timers did, in order.
	events: string[];
	rows: Row[];
	k6: K6Facts;
	k6Exit: number | null;
	requestsPerInstance: number[];
	samples: Sample[];
};

// Writes the report and prints the same text, so the file and the console show one result.
export function writeReport(input: ReportInput): void {
	const text = renderReport(input);
	writeFileSync(reportPath(`${input.name}.md`), text);
	console.log(`\n${text}`);
}

// The markdown of a run. Its layout is read by people who compare runs, so keep the lines and their order.
export function renderReport(input: ReportInput): string {
	const { name, profile, saleId, stock, events, rows, k6, k6Exit } = input;
	const lines = [
		`# Load run: ${name}`,
		"",
		`Sale ${saleId}. Stock ${stock}, ${profile.users} shoppers at ${profile.arrivalsPerSecond} a second and ${profile.latecomers} latecomers, ` +
			`hold ${profile.holdSeconds} s, admission ${profile.admitPerSecond} a second.`,
		...events.map((event) => `- ${event}`),
		"",
		"| Check | Expected | Actual | Result |",
		"| --- | --- | --- | --- |",
		...rows.map(
			(row) =>
				`| ${row.check} | ${row.expected} | ${row.actual} | ${row.pass ? "pass" : "FAIL"} |`,
		),
		"",
		`Informational: reserve p95 ${formatMs(k6.reserveP95)}, purchase p95 ${formatMs(k6.purchaseP95)}, ` +
			`server errors ${k6.serverErrors}, requests per instance ${input.requestsPerInstance.join(" / ")}, k6 exit code ${k6Exit}.`,
		sessionsLine(input.samples),
		"",
	];
	return lines.join("\n");
}

// The worst value of each Postgres session count over the run. Samples are taken back to back while k6 runs.
function sessionsLine(samples: Sample[]): string {
	const worst = (pick: (sample: Sample) => number) =>
		Math.max(0, ...samples.map(pick));
	return (
		`Postgres sessions, sampled back to back while k6 ran (${samples.length} samples): ` +
		`most waiting for a lock ${worst((s) => s.locked)}, ` +
		`most active ${worst((s) => s.active)}, ` +
		`most idle in a transaction ${worst((s) => s.idle)}.`
	);
}
