// A mock payment provider with real retry and refund rules. Outbound adapter for the Payment port, so the purchase flow
// runs end to end without money, and the application never sees the provider. Its charges live in a ledger that every
// instance of the API shares (decision 009), so a reservation is charged once however many instances confirm it.
import { randomUUID } from "node:crypto";
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok } from "@flash/typekit";
import type {
	Payment,
	PaymentResult,
} from "../../../application/ports/payment.js";
import type {
	LedgerEntry,
	PaymentLedger,
	Settlement,
} from "./payment-ledger.js";

// Settings for the mock. The optional `random`, `newId`, `sleep` and `log` are seams, so a test controls randomness, refs,
// waiting and logging.
export type MockPaymentOptions = {
	ledger: PaymentLedger;
	latencyMs: number;
	// Share of charges that are declined, from 0 to 1.
	failureRate: number;
	random?: () => number;
	// Makes the unique part of a new ref. A ref is never made from the reservation id alone, so a stale refund cannot give
	// back a later charge.
	newId?: () => string;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string) => void;
};

// The mock as the composition sees it. `statusOf` reads the ledger, so a scenario can see a charge or a refund, and
// `settings` can change while the app runs, so a scenario can make the payment slow or failing.
export type MockPayment = Payment & {
	statusOf: (reservationId: string) => Promise<LedgerEntry | undefined>;
	settings: { latencyMs: number; failureRate: number };
};

// The answer the port gives for an entry of the ledger: its ref when it is charged, else a decline.
function resultOf(entry: LedgerEntry): PaymentResult {
	return entry.status === "charged" && entry.ref !== undefined
		? new Ok({ ref: entry.ref })
		: new Err("declined");
}

// A payment provider over a shared ledger. A stored charge answers at once with its ref. Otherwise the mock waits for the
// latency with no connection held, draws its decline, and settles; a charge another instance stored first wins.
export function createMockPayment(options: MockPaymentOptions): MockPayment {
	const { ledger } = options;
	const random = options.random ?? Math.random;
	const newId = options.newId ?? randomUUID;
	const wait = options.sleep ?? sleep;
	const log = options.log ?? (() => {});
	const settings = {
		latencyMs: options.latencyMs,
		failureRate: options.failureRate,
	};

	return {
		settings,
		statusOf: (reservationId) => ledger.find(reservationId),

		async charge(reservationId) {
			const known = await ledger.find(reservationId);
			if (known?.status === "charged") return resultOf(known);
			await wait(settings.latencyMs);
			const settlement: Settlement =
				random() < settings.failureRate
					? { status: "declined" }
					: { status: "charged", ref: `mock-${newId()}` };
			return resultOf(await ledger.settle(reservationId, settlement));
		},

		async refund(ref) {
			if (await ledger.refund(ref)) log(`payment refunded: ${ref}`);
		},
	};
}
