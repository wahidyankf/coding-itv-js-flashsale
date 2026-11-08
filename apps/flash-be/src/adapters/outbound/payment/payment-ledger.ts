// The mock provider's own ledger of charges, one entry per reservation id: the contract the mock pays through, so that a
// charge stays idempotent across every instance of the API (decision 009). An adapter detail of the mock, not an
// application port. Postgres keeps it for the app (postgres/payment-ledger.ts); memory keeps it for the unit scenarios.

// Where a payment stands. Only a refund of its own ref moves a `charged` entry to another status.
export type PaymentStatus = "charged" | "declined" | "refunded";

// One entry of the ledger. `ref` is set for a charge and kept after its refund; `attempts` counts the settles that
// wrote the entry, so a settle that met a stored charge is not counted.
export type LedgerEntry = {
	status: PaymentStatus;
	ref: string | undefined;
	attempts: number;
};

// What one attempt to charge came to, as the mock settles it.
export type Settlement =
	| { status: "charged"; ref: string }
	| { status: "declined" };

// The ledger behind the mock. Each operation is atomic by contract, so two instances that settle the same reservation at
// once end with one charge and one ref.
export type PaymentLedger = {
	// The entry of this reservation, if it was ever settled.
	find(reservationId: string): Promise<LedgerEntry | undefined>;
	// Writes the attempt, unless the entry is already charged: a stored charge wins over this attempt, so its ref is the
	// one returned. Returns the entry as it stands after the write.
	settle(reservationId: string, settlement: Settlement): Promise<LedgerEntry>;
	// Moves the charged entry with this ref to refunded. A second refund, a stale ref, or a ref that a live purchase holds
	// changes nothing. True when the entry changed.
	refund(ref: string): Promise<boolean>;
};
