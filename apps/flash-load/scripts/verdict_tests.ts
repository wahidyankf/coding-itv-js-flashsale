// Unit tests for the verdict of a load run: each check passes on the facts it should accept and fails on the ones it should
// refuse, and a profile that does not judge speed judges only the invariants. The facts are written out by hand, so no
// test needs Docker, k6 or Postgres.
import { describe, expect, it } from "vitest";
import { LIMITS, PROFILES } from "../k6/profiles.ts";
import type { K6Facts, RunFacts } from "./collect.ts";
import { formatMs, judgeRun, type Row } from "./verdict.ts";

// A run that meets every check: the sale sold out exactly, each purchase counted once, k6 and Postgres agree, the queue
// limited the flood, and the timings are under their limits.
const CLEAN_K6: K6Facts = {
	purchased: 100,
	rateLimited: 3,
	serverErrors: 0,
	dropped: 0,
	missingAccounts: 0,
	abandonedShoppers: 0,
	abandonedLatecomers: 0,
	reserveP95: LIMITS.reserveP95Ms - 1,
	purchaseP95: LIMITS.purchaseP95Ms - 1,
};
const CLEAN: RunFacts = {
	postgres: { stock: 100, sold: 100, purchases: 100, twice: 0 },
	k6: CLEAN_K6,
	redisBuyers: 100,
};

const JUDGED = PROFILES.full;
const NOT_JUDGED = PROFILES.chaos;

// The row for one check. A missing row throws, so a renamed check cannot pass unnoticed.
function rowOf(rows: Row[], check: string): Row {
	const found = rows.find((row) => row.check === check);
	if (!found) throw new Error(`no row named "${check}"`);
	return found;
}

describe("judgeRun", () => {
	it("passes every row of a clean run on a profile that judges speed", () => {
		const rows = judgeRun(JUDGED, CLEAN);
		expect(rows.map((row) => row.check)).toEqual([
			"k6 started every planned shopper",
			"k6 had an account for every shopper",
			"no oversell: sold is at most the stock",
			"the sold count equals the purchases",
			"no shopper bought twice",
			"k6 and Postgres agree on purchases",
			"the stock sold out",
			"the shopper who floods the queue is limited",
			"Redis and Postgres agree on buyers",
			"reserve p95",
			"purchase p95",
			"server errors",
		]);
		expect(rows.every((row) => row.pass)).toBe(true);
	});

	it("judges only the invariants on a profile that does not judge speed", () => {
		// A Redis count that differs and timings far over the limits do not count on this profile.
		const rows = judgeRun(NOT_JUDGED, {
			...CLEAN,
			redisBuyers: 999,
			k6: { ...CLEAN_K6, reserveP95: 9999, purchaseP95: undefined },
		});
		expect(rows).toHaveLength(8);
		expect(rows.every((row) => row.pass)).toBe(true);
	});

	it("leaves out the Redis row when Redis did not answer at the end", () => {
		const rows = judgeRun(JUDGED, { ...CLEAN, redisBuyers: undefined });
		expect(rows.map((row) => row.check)).not.toContain(
			"Redis and Postgres agree on buyers",
		);
	});

	it.each<[string, Partial<RunFacts>]>([
		["k6 started every planned shopper", { k6: { ...CLEAN_K6, dropped: 1 } }],
		[
			"k6 had an account for every shopper",
			{ k6: { ...CLEAN_K6, missingAccounts: 1 } },
		],
		[
			"no oversell: sold is at most the stock",
			{ postgres: { stock: 100, sold: 101, purchases: 101, twice: 0 } },
		],
		[
			"the sold count equals the purchases",
			{ postgres: { stock: 100, sold: 100, purchases: 99, twice: 0 } },
		],
		[
			"no shopper bought twice",
			{ postgres: { stock: 100, sold: 100, purchases: 100, twice: 1 } },
		],
		[
			"k6 and Postgres agree on purchases",
			{ k6: { ...CLEAN_K6, purchased: 99 } },
		],
		[
			"the stock sold out",
			{ postgres: { stock: 100, sold: 99, purchases: 99, twice: 0 } },
		],
		[
			"the shopper who floods the queue is limited",
			{ k6: { ...CLEAN_K6, rateLimited: 0 } },
		],
	])("fails %j when the run breaks it", (check, change) => {
		const rows = judgeRun(JUDGED, { ...CLEAN, ...change });
		expect(rowOf(rows, check).pass).toBe(false);
	});

	it("fails the Redis row when Redis counts other buyers than Postgres", () => {
		const row = rowOf(
			judgeRun(JUDGED, { ...CLEAN, redisBuyers: 99 }),
			"Redis and Postgres agree on buyers",
		);
		expect(row).toEqual({
			check: "Redis and Postgres agree on buyers",
			expected: "100",
			actual: "99",
			pass: false,
		});
	});

	it("passes a timing only when it is under its limit", () => {
		const under = judgeRun(JUDGED, {
			...CLEAN,
			k6: { ...CLEAN_K6, reserveP95: LIMITS.reserveP95Ms - 1 },
		});
		const atLimit = judgeRun(JUDGED, {
			...CLEAN,
			k6: { ...CLEAN_K6, reserveP95: LIMITS.reserveP95Ms },
		});
		expect(rowOf(under, "reserve p95").pass).toBe(true);
		expect(rowOf(atLimit, "reserve p95").pass).toBe(false);
	});

	it("fails a timing that k6 did not measure, and says so in the row", () => {
		const row = rowOf(
			judgeRun(JUDGED, {
				...CLEAN,
				k6: { ...CLEAN_K6, purchaseP95: undefined },
			}),
			"purchase p95",
		);
		expect(row).toEqual({
			check: "purchase p95",
			expected: `< ${LIMITS.purchaseP95Ms} ms`,
			actual: "not measured",
			pass: false,
		});
	});

	it("allows no server error at all", () => {
		const rows = judgeRun(JUDGED, {
			...CLEAN,
			k6: { ...CLEAN_K6, serverErrors: 1 },
		});
		expect(rowOf(rows, "server errors")).toEqual({
			check: "server errors",
			expected: String(LIMITS.serverErrors),
			actual: "1",
			pass: false,
		});
	});
});

describe("formatMs", () => {
	it("shows a timing in milliseconds with one decimal", () => {
		expect(formatMs(12.34)).toBe("12.3 ms");
		expect(formatMs(0)).toBe("0.0 ms");
	});

	it("says not measured when k6 measured no timing", () => {
		expect(formatMs(undefined)).toBe("not measured");
	});
});
