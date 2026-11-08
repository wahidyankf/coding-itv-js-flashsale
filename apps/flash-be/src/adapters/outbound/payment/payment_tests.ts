// Unit tests for the mock payment (adapter layer, outbound) over a ledger in memory: one charge per reservation, a stored
// charge answered with no wait, a decline that a retry can turn into a charge, and a refund that is safe to repeat.
import { Err, Ok } from "@flash/typekit";
import { expect, it } from "vitest";
import { createMemoryPaymentLedger } from "../memory/memory-payment-ledger.js";
import { createMockPayment, type MockPaymentOptions } from "./mock-payment.js";
import type { PaymentLedger } from "./payment-ledger.js";

// A mock over `ledger` whose refs are mock-1, mock-2 and so on, that counts its waits and keeps its log lines.
function mockOver(
	ledger: PaymentLedger,
	options: Partial<MockPaymentOptions> = {},
) {
	let refs = 0;
	const waits: number[] = [];
	const lines: string[] = [];
	const payment = createMockPayment({
		ledger,
		latencyMs: 150,
		failureRate: 0,
		newId: () => String(++refs),
		sleep: async (ms) => {
			waits.push(ms);
		},
		log: (line) => lines.push(line),
		...options,
	});
	return { payment, waits, lines };
}

it("charges a reservation once and returns the same ref, with no wait, to a retry", async () => {
	const { payment, waits } = mockOver(createMemoryPaymentLedger());
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-1" }));
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-1" }));
	expect(waits).toEqual([150]);
});

it("charges once when two instances share one ledger, and both get the same ref", async () => {
	const ledger = createMemoryPaymentLedger();
	const first = mockOver(ledger).payment;
	const second = mockOver(ledger, { newId: () => "other" }).payment;
	const [a, b] = await Promise.all([first.charge("r1"), second.charge("r1")]);
	expect(a).toEqual(b);
	expect(await first.statusOf("r1")).toEqual({
		status: "charged",
		ref: "mock-1",
		attempts: 1,
	});
});

it("returns the stored charge when its own draw is a decline", async () => {
	const ledger = createMemoryPaymentLedger();
	await ledger.settle("r1", { status: "charged", ref: "mock-a" });
	const { payment } = mockOver(ledger, { failureRate: 1 });
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-a" }));
});

it("records a decline, and charges on the next try", async () => {
	const draws = [0.1, 0.9];
	const { payment } = mockOver(createMemoryPaymentLedger(), {
		failureRate: 0.5,
		random: () => draws.shift() ?? 1,
	});
	expect(await payment.charge("r1")).toEqual(new Err("declined"));
	expect(await payment.statusOf("r1")).toEqual({
		status: "declined",
		ref: undefined,
		attempts: 1,
	});
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-1" }));
	expect((await payment.statusOf("r1"))?.attempts).toBe(2);
});

it("refunds once: a second refund changes nothing and writes no second line", async () => {
	const { payment, lines } = mockOver(createMemoryPaymentLedger());
	await payment.charge("r1");
	await payment.refund("mock-1");
	await payment.refund("mock-1");
	expect((await payment.statusOf("r1"))?.status).toBe("refunded");
	expect(lines).toEqual(["payment refunded: mock-1"]);
});

it("charges a refunded reservation again with a new ref, which an old refund cannot give back", async () => {
	const { payment } = mockOver(createMemoryPaymentLedger());
	await payment.charge("r1");
	await payment.refund("mock-1");
	expect(await payment.charge("r1")).toEqual(new Ok({ ref: "mock-2" }));
	await payment.refund("mock-1");
	expect((await payment.statusOf("r1"))?.status).toBe("charged");
});

it("knows no status for a reservation it never charged", async () => {
	const { payment } = mockOver(createMemoryPaymentLedger());
	expect(await payment.statusOf("r1")).toBeUndefined();
});
