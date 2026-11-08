// Unit tests for the payment ledger in memory: a stored charge wins, a decline is a new attempt, and a refund is idempotent.
import { expect, it } from "vitest";
import { createMemoryPaymentLedger } from "./memory-payment-ledger.js";

it("finds nothing for a reservation that was never settled", async () => {
	expect(await createMemoryPaymentLedger().find("r1")).toBeUndefined();
});

it("keeps the first charge when a second one settles the same reservation", async () => {
	const ledger = createMemoryPaymentLedger();
	await ledger.settle("r1", { status: "charged", ref: "mock-a" });
	const second = await ledger.settle("r1", {
		status: "charged",
		ref: "mock-b",
	});
	expect(second).toEqual({ status: "charged", ref: "mock-a", attempts: 1 });
	expect(await ledger.find("r1")).toEqual(second);
});

it("lets a stored charge win over a declined draw", async () => {
	const ledger = createMemoryPaymentLedger();
	await ledger.settle("r1", { status: "charged", ref: "mock-a" });
	expect(await ledger.settle("r1", { status: "declined" })).toEqual({
		status: "charged",
		ref: "mock-a",
		attempts: 1,
	});
});

it("counts a charge after a decline as the second attempt", async () => {
	const ledger = createMemoryPaymentLedger();
	expect(await ledger.settle("r1", { status: "declined" })).toEqual({
		status: "declined",
		ref: undefined,
		attempts: 1,
	});
	expect(
		await ledger.settle("r1", { status: "charged", ref: "mock-a" }),
	).toEqual({ status: "charged", ref: "mock-a", attempts: 2 });
});

it("refunds a charge once, and ignores a second or a stale refund", async () => {
	const ledger = createMemoryPaymentLedger();
	await ledger.settle("r1", { status: "charged", ref: "mock-a" });
	expect(await ledger.refund("mock-a")).toBe(true);
	expect(await ledger.refund("mock-a")).toBe(false);
	await ledger.settle("r1", { status: "charged", ref: "mock-b" });
	expect(await ledger.refund("mock-a")).toBe(false);
	expect(await ledger.find("r1")).toEqual({
		status: "charged",
		ref: "mock-b",
		attempts: 2,
	});
});
