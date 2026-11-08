// Unit tests of the k6 summary reader of the load runner: the counts and timings it takes from a summary object, including
// the abandoned holds that the report shows for information. The summary is a plain object here, so no k6 run is needed.
import { describe, expect, it } from "vitest";
import { k6FactsOf } from "./collect.ts";

describe("k6FactsOf", () => {
	it("reads the abandoned holds of shoppers and of latecomers", () => {
		const facts = k6FactsOf({
			metrics: {
				abandoned_shoppers: { type: "counter", values: { count: 5 } },
				abandoned_latecomers: { type: "counter", values: { count: 0 } },
			},
		});
		expect(facts.abandonedShoppers).toBe(5);
		expect(facts.abandonedLatecomers).toBe(0);
	});

	it("counts an abandoned-hold counter k6 did not report as zero", () => {
		const facts = k6FactsOf({ metrics: {} });
		expect(facts.abandonedShoppers).toBe(0);
		expect(facts.abandonedLatecomers).toBe(0);
	});

	it("reads the purchases and the 95th percentile of the timed requests", () => {
		const facts = k6FactsOf({
			metrics: {
				purchased: { type: "counter", values: { count: 3 } },
				"http_req_duration{name:reserve}": {
					type: "trend",
					values: { "p(95)": 120.5 },
				},
			},
		});
		expect(facts.purchased).toBe(3);
		expect(facts.reserveP95).toBe(120.5);
		expect(facts.purchaseP95).toBeUndefined();
	});
});
