// Unit tests for the markdown of a run: the header, the verdict table, the events, the informational line and the
// Postgres sessions. The report is read by people who compare runs, so the lines and their order are checked here.
import { describe, expect, it } from "vitest";
import { PROFILES } from "../k6/profiles.ts";
import type { K6Facts } from "./collect.ts";
import { type ReportInput, renderReport } from "./report.ts";

const K6: K6Facts = {
	purchased: 100,
	rateLimited: 3,
	serverErrors: 0,
	dropped: 0,
	missingAccounts: 0,
	reserveP95: 120.25,
	purchaseP95: undefined,
};

function input(overrides: Partial<ReportInput> = {}): ReportInput {
	return {
		name: "full",
		profile: PROFILES.full,
		saleId: "sale-1",
		stock: 100,
		events: ["redis stopped at 4 s"],
		rows: [
			{ check: "no oversell", expected: "<= 100", actual: "100", pass: true },
			{
				check: "reserve p95",
				expected: "< 300 ms",
				actual: "not measured",
				pass: false,
			},
		],
		k6: K6,
		k6Exit: 0,
		requestsPerInstance: [10, 20, 30],
		samples: [
			{ locked: 2, active: 5, idle: 1 },
			{ locked: 0, active: 7, idle: 3 },
		],
		...overrides,
	};
}

describe("renderReport", () => {
	it("names the run and describes the sale and the profile in its first lines", () => {
		const lines = renderReport(input()).split("\n");
		expect(lines[0]).toBe("# Load run: full");
		expect(lines[2]).toBe(
			"Sale sale-1. Stock 100, 5000 shoppers at 250 a second and 100 latecomers, hold 10 s, admission 300 a second.",
		);
	});

	it("lists the chaos events, then the verdict table with a row for each check", () => {
		const text = renderReport(input());
		expect(text).toContain("- redis stopped at 4 s\n");
		expect(text).toContain(
			"| Check | Expected | Actual | Result |\n| --- | --- | --- | --- |\n| no oversell | <= 100 | 100 | pass |\n| reserve p95 | < 300 ms | not measured | FAIL |",
		);
	});

	it("shows the timings and the instance counts for information, with the k6 exit code", () => {
		const text = renderReport(input());
		expect(text).toContain(
			"Informational: reserve p95 120.3 ms, purchase p95 not measured, server errors 0, requests per instance 10 / 20 / 30, k6 exit code 0.",
		);
	});

	it("keeps the worst value of each Postgres session count", () => {
		expect(renderReport(input())).toContain(
			"Postgres sessions, sampled back to back while k6 ran (2 samples): most waiting for a lock 2, most active 7, most idle in a transaction 3.",
		);
	});

	it("reads zero for each session count when no sample was taken", () => {
		expect(renderReport(input({ samples: [] }))).toContain(
			"(0 samples): most waiting for a lock 0, most active 0, most idle in a transaction 0.",
		);
	});

	it("says when k6 did not exit with a code", () => {
		expect(renderReport(input({ k6Exit: null }))).toContain(
			"k6 exit code null.",
		);
	});
});
