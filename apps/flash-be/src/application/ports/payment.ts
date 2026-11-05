import type { Result } from "@flash/typekit";

// A charge that went through. The ref is what a refund names.
export type Charge = { ref: string };

export type PaymentResult = Result<Charge, "declined">;

// The payment provider sits behind this port. The shop has no real provider; a mock stands in (see mock-payment.ts).
export type Payment = {
	// Charging the same reservation twice must not charge twice: the second call returns the first result.
	charge(reservationId: string): Promise<PaymentResult>;
	// Gives the money back, for example when the item is gone by the time the payment is done.
	refund(ref: string): Promise<void>;
};
