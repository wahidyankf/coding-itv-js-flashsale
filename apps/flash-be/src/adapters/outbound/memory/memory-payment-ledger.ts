// The mock provider's ledger in memory, for one process: the unit scenarios and the unit tests of the mock. The rules are
// the Postgres ledger's (postgres/payment-ledger.ts), and the integration tests hold that one to them. Outbound adapter.
import type { LedgerEntry, PaymentLedger } from "../payment/payment-ledger.js";

// What the memory ledger may know of the purchases. `heldByPurchase` tells whether a purchase holds a ref, as the
// Postgres ledger asks the purchases table; with none given, no purchase ever holds one.
export type MemoryLedgerOptions = {
	heldByPurchase?: (ref: string) => boolean;
};

// The memory ledger, plus the check a purchase store in memory makes before it commits: whether a ref is still charged.
// It answers at once, so a commit in memory can make it with no wait between the check and the write.
export type MemoryPaymentLedger = PaymentLedger & {
	isCharged: (ref: string) => boolean;
};

// The ledger in memory. Each operation runs to its end before another starts, which makes it atomic as the contract asks.
// A refund leaves a charge alone while a purchase holds its ref.
export function createMemoryPaymentLedger(
	options: MemoryLedgerOptions = {},
): MemoryPaymentLedger {
	const heldByPurchase = options.heldByPurchase ?? (() => false);
	const entries = new Map<string, LedgerEntry>();
	return {
		isCharged: (ref) =>
			[...entries.values()].some(
				(entry) => entry.status === "charged" && entry.ref === ref,
			),
		async find(reservationId) {
			const entry = entries.get(reservationId);
			return entry && { ...entry };
		},
		async settle(reservationId, settlement) {
			const stored = entries.get(reservationId);
			if (stored?.status === "charged") return { ...stored };
			const entry: LedgerEntry = {
				status: settlement.status,
				ref: settlement.status === "charged" ? settlement.ref : undefined,
				attempts: (stored?.attempts ?? 0) + 1,
			};
			entries.set(reservationId, entry);
			return { ...entry };
		},
		async refund(ref) {
			const charged = [...entries.values()].find(
				(entry) => entry.status === "charged" && entry.ref === ref,
			);
			if (charged === undefined || heldByPurchase(ref)) return false;
			charged.status = "refunded";
			return true;
		},
	};
}
