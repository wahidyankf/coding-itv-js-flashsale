import type {
	Payment,
	PaymentResult,
} from "../../../application/ports/payment.js";

export type MockPaymentOptions = {
	latencyMs: number;
	// Share of charges that are declined, from 0 to 1.
	failureRate: number;
	random?: () => number;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string) => void;
};

export type MockPayment = Payment & {
	readonly refunded: string[];
	settings: { latencyMs: number; failureRate: number };
};

// A payment provider that lives in the process. It waits `latencyMs`, then accepts or declines at random. A charge
// is remembered by reservation id while it runs and after it succeeds, so a retry never charges twice. A declined
// charge is forgotten, so the shopper can try again.
export function createMockPayment(options: MockPaymentOptions): MockPayment {
	const random = options.random ?? Math.random;
	const sleep =
		options.sleep ??
		((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const log = options.log ?? (() => {});
	const charges = new Map<string, Promise<PaymentResult>>();
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
				await sleep(settings.latencyMs);
				if (random() < settings.failureRate) {
					charges.delete(reservationId);
					return { ok: false };
				}
				return { ok: true, ref: `mock-${reservationId}` };
			})();
			charges.set(reservationId, attempt);
			return attempt;
		},

		async refund(ref) {
			refunded.push(ref);
			log(`payment refunded: ${ref}`);
		},
	};
}
