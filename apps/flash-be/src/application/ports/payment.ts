export type PaymentResult = { ok: true; ref: string } | { ok: false };

// The payment provider sits behind this port. The shop has no real provider; a mock stands in (see mock-payment.ts).
export type Payment = {
	// Charging the same reservation twice must not charge twice: the second call returns the first result.
	charge(reservationId: string): Promise<PaymentResult>;
	// Gives the money back, for example when the item is gone by the time the payment is done.
	refund(ref: string): Promise<void>;
};
