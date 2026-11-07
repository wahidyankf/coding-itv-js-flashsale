// Kind: a plain port (no suffix). The payment provider, behind a port. The shop has no real provider; a mock stands in
// (see mock-payment.ts).
import type { Result } from "@flash/typekit";

// A charge that went through. The ref is what a refund names.
export type Charge = { ref: string };

// What a charge answers: the charge that went through, or a decline. A decline is a value, so the purchase can report it.
export type PaymentResult = Result<Charge, "declined">;

// The payment provider behind its port. A retry for the same hold gets the first answer back, so a retry never bills twice.
export type Payment = {
	// Charges for a held item. Charging the same reservation again returns the first result, so a retry never
	// charges twice.
	charge(reservationId: string): Promise<PaymentResult>;
	// Gives the money back, for example when the item is gone by the time the payment is done.
	refund(ref: string): Promise<void>;
};
