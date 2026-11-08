// The mock provider's ledger in memory, for one process: the unit scenarios and the unit tests of the mock. The rules are
// the Postgres ledger's (postgres/payment-ledger.ts), and the integration tests hold that one to them. Outbound adapter.
import type { LedgerEntry, PaymentLedger } from "../payment/payment-ledger.js";

// The ledger in memory. Each operation runs to its end before another starts, which makes it atomic as the contract asks.
export function createMemoryPaymentLedger(): PaymentLedger {
	const entries = new Map<string, LedgerEntry>();
	return {
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
			if (charged === undefined) return false;
			charged.status = "refunded";
			return true;
		},
	};
}
