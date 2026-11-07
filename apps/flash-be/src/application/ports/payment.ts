// The payment provider, behind a port. The shop has no real provider; a mock stands in (see mock-payment.ts).
import type { Result } from "@flash/typekit";

// A charge that went through. The ref is what a refund names.
export type Charge = { ref: string };

export type PaymentResult = Result<Charge, "declined">;

export type Payment = {
	// Charges for a held item. Charging the same reservation again returns the first result, so a retry never
	// charges twice.
	charge(reservationId: string): Promise<PaymentResult>;
	// Gives the money back, for example when the item is gone by the time the payment is done.
	refund(ref: string): Promise<void>;
};
