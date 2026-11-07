// The payment provider of flash-be, which lives in the process: a mock with real retry and refund rules. Outbound adapter
// for the Payment port. It stands in for a real provider, so the purchase flow can be run end to end without money. It
// sits behind the Payment port, so the application never sees which provider runs.
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok } from "@flash/typekit";
import type {
	Payment,
	PaymentResult,
} from "../../../application/ports/payment.js";

// How the mock behaves: how long a charge takes, how often it declines, and the seams a test uses to replace randomness,
// waiting and logging.
export type MockPaymentOptions = {
	latencyMs: number;
	// Share of charges that are declined, from 0 to 1.
	failureRate: number;
	random?: () => number;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string) => void;
};

// The mock as the composition sees it. `refunded` lists the refs refunded so far, and `settings` can change while the
// app runs, so a scenario can make the payment slow or failing.
export type MockPayment = Payment & {
	readonly refunded: string[];
	settings: { latencyMs: number; failureRate: number };
};

// A payment provider that lives in the process. It waits `latencyMs`, then accepts or declines at random. A charge
// is remembered by reservation id while it runs and after it succeeds, so a retry never charges twice. A declined
// charge is forgotten, so the shopper can try again. A refund forgets the charge too: the money is back, so a retry of
// the same reservation is a new charge, and the old success is not refunded a second time.
export function createMockPayment(options: MockPaymentOptions): MockPayment {
	const random = options.random ?? Math.random;
	const wait = options.sleep ?? sleep;
	const log = options.log ?? (() => {});
	const charges = new Map<string, Promise<PaymentResult>>();
	// The reservation of each successful charge, by its ref, so a refund can find the charge it gives back.
	const reservationByRef = new Map<string, string>();
	const refunded: string[] = [];
	const settings = {
		latencyMs: options.latencyMs,
		failureRate: options.failureRate,
	};

	return {
		refunded,
		settings,

		charge(reservationId) {
			const known = charges.get(reservationId);
			if (known !== undefined) return known;
			const attempt = (async (): Promise<PaymentResult> => {
				await wait(settings.latencyMs);
				if (random() < settings.failureRate) {
					charges.delete(reservationId);
					return new Err("declined");
				}
				const ref = `mock-${reservationId}`;
				reservationByRef.set(ref, reservationId);
				return new Ok({ ref });
			})();
			charges.set(reservationId, attempt);
			return attempt;
		},

		async refund(ref) {
			refunded.push(ref);
			const reservationId = reservationByRef.get(ref);
			if (reservationId !== undefined) {
				charges.delete(reservationId);
				reservationByRef.delete(ref);
			}
			log(`payment refunded: ${ref}`);
		},
	};
}
