import { Err, Ok } from "@flash/typekit";
import { expect, it } from "vitest";
import { createMockPayment } from "./mock-payment.js";

// A retry of the same reservation must reuse the first charge, and a decline must be forgotten.
it("charges a reservation once and returns the same result to a retry", async () => {
	let sleeps = 0;
	const payment = createMockPayment({
		latencyMs: 0,
		failureRate: 0,
		sleep: async () => {
			sleeps++;
		},
	});
	const first = await payment.charge("r1");
	const second = await payment.charge("r1");
	expect(second).toEqual(first);
	expect(sleeps).toBe(1);
});

it("forgets a declined charge so the shopper can try again", async () => {
	const draws = [0.1, 0.9];
	const payment = createMockPayment({
		latencyMs: 0,
		failureRate: 0.5,
		random: () => draws.shift() ?? 1,
		sleep: async () => {},
	});
	expect(await payment.charge("r1")).toEqual(new Err("declined"));
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-r1" }));
});
