// What a run reads once k6 has finished: Postgres, Redis and the k6 summary. This file does no judging; the verdict compares the facts.
// It also counts the requests each API instance logged, so the report shows whether the instances shared the work. Part of the load runner in scripts/.
import { readFileSync } from "node:fs";
import type { ProfileName } from "../k6/profiles.ts";
import {
	composeExec,
	composeOutput,
	execArgs,
	k6SummaryFile,
	psql,
	reportPath,
} from "./compose.ts";

// The API instances in compose.yaml. Keep this count equal to the flash-be instances in that file.
const INSTANCE_COUNT = 3;
// The log line the API writes for each request it receives.
const REQUEST_LOG_LINE = '"incoming request"';

// What Postgres says about the sale after a run. The verdict checks that nothing was oversold and that no shopper bought
// twice, so these counts must come from the database itself.
export type PostgresFacts = {
	stock: number;
	sold: number;
	// Purchase rows, and the shoppers who have more than one of them.
	purchases: number;
	twice: number;
};

// What k6 counted and timed in one run, read from its summary. The verdict judges these against the limits in
// k6/profiles.ts; the counts are k6's own, not the app's.
export type K6Facts = {
	purchased: number;
	rateLimited: number;
	serverErrors: number;
	dropped: number;
	// Shoppers k6 had no signed-up account for. Each one is a harness fault, not a result.
	missingAccounts: number;
	// Holds a shopper walked away from, split by kind of shopper. Shown for information; no verdict row judges them.
	abandonedShoppers: number;
	abandonedLatecomers: number;
	// The 95th percentile of the two timed requests, in milliseconds. Undefined when k6 timed none.
	reserveP95: number | undefined;
	purchaseP95: number | undefined;
};

// Everything one run reads once k6 has finished. The verdict and the report take it whole, so they judge the same facts.
export type RunFacts = {
	postgres: PostgresFacts;
	k6: K6Facts;
	// The buyers Redis lists for the sale. Undefined when Redis did not answer at the end of the run.
	redisBuyers: number | undefined;
};

// Reads the sale and its purchases from Postgres. The soft-deleted purchases do not count.
export function readPostgres(saleId: string): PostgresFacts {
	const [stock = 0, sold = 0] = psql(
		`select stock, sold from sales where id = '${saleId}'`,
	)
		.split("|")
		.map(Number);
	const purchases = Number(
		psql(
			`select count(*) from purchases where sale_id = '${saleId}' and deleted_at is null`,
		),
	);
	const twice = Number(
		psql(
			`select count(*) from (select user_id from purchases where sale_id = '${saleId}' and deleted_at is null group by user_id having count(*) > 1) d`,
		),
	);
	return { stock, sold, purchases, twice };
}

// Reads what k6 reported, from the summary it wrote when it finished. The caller checks that the file exists.
export function readK6(name: ProfileName): K6Facts {
	const summary: unknown = JSON.parse(
		readFileSync(reportPath(k6SummaryFile(name)), "utf8"),
	);
	return k6FactsOf(summary);
}

// The counts and timings of one k6 summary object. Kept apart from the file read, so the summary can be checked on its own.
// A counter or timing k6 did not report reads as zero or as undefined.
export function k6FactsOf(summary: unknown): K6Facts {
	return {
		purchased: counter(summary, "purchased"),
		rateLimited: counter(summary, "rate_limited"),
		serverErrors: counter(summary, "server_errors"),
		dropped: counter(summary, "dropped_iterations"),
		missingAccounts: counter(summary, "missing_accounts"),
		abandonedShoppers: counter(summary, "abandoned_shoppers"),
		abandonedLatecomers: counter(summary, "abandoned_latecomers"),
		reserveP95: metric(summary, "http_req_duration{name:reserve}", "p(95)"),
		purchaseP95: metric(summary, "http_req_duration{name:purchase}", "p(95)"),
	};
}

// Asks Redis how many buyers the sale has. Redis is pinged first, because a Redis that does not answer has no count.
export function readRedisBuyers(saleId: string): number | undefined {
	const up = composeExec(
		execArgs("redis", ["redis-cli", "ping"]),
	).stdout.includes("PONG");
	if (!up) return undefined;
	return Number(
		composeOutput(
			execArgs("redis", ["redis-cli", "scard", `sale:${saleId}:buyers`]),
		).trim(),
	);
}

// How many requests each API instance logged, in the order of the instances.
export function requestsPerInstance(): number[] {
	return Array.from({ length: INSTANCE_COUNT }, (_, index) => index + 1).map(
		(n) => {
			const logs = composeExec([
				"logs",
				"--no-log-prefix",
				`flash-be-${n}`,
			]).stdout;
			return logs.split(REQUEST_LOG_LINE).length - 1;
		},
	);
}

// The count of a k6 counter. A counter k6 did not report counts as zero.
function counter(summary: unknown, key: string): number {
	return metric(summary, key, "count") ?? 0;
}

// One value of a k6 summary. k6 writes it either under `values` or directly under the metric.
function metric(
	summary: unknown,
	key: string,
	field: string,
): number | undefined {
	const entry = (
		summary as { metrics?: Record<string, Record<string, unknown>> }
	).metrics?.[key];
	const values = (entry?.values ?? entry) as
		| Record<string, unknown>
		| undefined;
	const value = values?.[field];
	return typeof value === "number" ? value : undefined;
}
