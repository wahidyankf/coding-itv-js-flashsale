// The verdict of a run: each check with what it expects and what it saw. The rules are in specs/apps/flash/load/checks.md
// and limits.md. This file only compares facts, so it does no I/O and the checks can be read on their own.
import { LIMITS, type Profile } from "../k6/profiles.ts";
import type { K6Facts, PostgresFacts, RunFacts } from "./collect.ts";

// One line of the verdict table.
export type Row = {
	check: string;
	expected: string;
	actual: string;
	pass: boolean;
};

// Judges one run. The invariants are judged on every profile. The Redis comparison and the speed limits are judged only
// on the profiles that judge speed: a profile that breaks a dependency judges its invariants and nothing else.
export function judgeRun(profile: Profile, facts: RunFacts): Row[] {
	const rows = invariantRows(facts.postgres, facts.k6);
	if (!profile.judgeSpeed) return rows;
	if (facts.redisBuyers !== undefined) {
		rows.push(redisRow(facts.postgres.purchases, facts.redisBuyers));
	}
	rows.push(...speedRows(facts.k6));
	return rows;
}

const row = (
	check: string,
	expected: string,
	actual: string,
	pass: boolean,
): Row => ({ check, expected, actual, pass });

// The invariants of the sale. A failure is a bug in the sale path, never a result to accept.
function invariantRows(postgres: PostgresFacts, k6: K6Facts): Row[] {
	const { stock, sold, purchases, twice } = postgres;
	return [
		// A generator that cannot start every planned shopper has not applied the planned load.
		row(
			"k6 started every planned shopper",
			"0 dropped",
			String(k6.dropped),
			k6.dropped === 0,
		),
		row(
			"no oversell: sold is at most the stock",
			`<= ${stock}`,
			String(sold),
			sold <= stock,
		),
		row(
			"the sold count equals the purchases",
			String(purchases),
			String(sold),
			sold === purchases,
		),
		row("no shopper bought twice", "0", String(twice), twice === 0),
		row(
			"k6 and Postgres agree on purchases",
			String(purchases),
			String(k6.purchased),
			k6.purchased === purchases,
		),
		row("the stock sold out", String(stock), String(sold), sold === stock),
		row(
			"the shopper who floods the queue is limited",
			"> 0 replies of 429",
			String(k6.rateLimited),
			k6.rateLimited > 0,
		),
	];
}

// Redis and Postgres must count the same buyers.
function redisRow(purchases: number, buyers: number): Row {
	return row(
		"Redis and Postgres agree on buyers",
		String(purchases),
		String(buyers),
		buyers === purchases,
	);
}

// The speed and error limits. Each one is fixed before a run (limits.md).
function speedRows(k6: K6Facts): Row[] {
	const { reserveP95, purchaseP95, serverErrors } = k6;
	return [
		row(
			"reserve p95",
			`< ${LIMITS.reserveP95Ms} ms`,
			formatMs(reserveP95),
			fast(reserveP95, LIMITS.reserveP95Ms),
		),
		row(
			"purchase p95",
			`< ${LIMITS.purchaseP95Ms} ms`,
			formatMs(purchaseP95),
			fast(purchaseP95, LIMITS.purchaseP95Ms),
		),
		row(
			"server errors",
			String(LIMITS.serverErrors),
			String(serverErrors),
			serverErrors <= LIMITS.serverErrors,
		),
	];
}

// A timing as the report shows it, in milliseconds with one decimal. A timing k6 did not measure reads "undefined".
export function formatMs(value: number | undefined): string {
	return `${value?.toFixed(1)} ms`;
}

// A timed value passes when it is under the limit. A value k6 did not measure fails.
function fast(value: number | undefined, limit: number): boolean {
	return value !== undefined && value < limit;
}
