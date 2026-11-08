// Kind: repository (a record kept in Postgres, which survives a Redis outage). Purchases and their holds. A purchase is
// written in the same transaction that checks the stock. Application layer, port.
import type { Purchase } from "../../domain/purchase.js";
import type { Reservation } from "../../domain/reservation.js";
import type { Username } from "../../domain/user.js";

// What a commit writes. The payment ref lets a refund name the charge.
export type CommitInput = {
	saleId: string;
	user: Username;
	reservationId: string;
	paymentRef: string;
};

// What a commit answered. `created` is true only when this call wrote the purchase. It is false when an earlier call
// with the same reservation already did, so a retry gets the same purchase back and is not counted twice.
export type CommitResult =
	| { kind: "purchased"; purchase: Purchase; created: boolean }
	| { kind: "sold_out" }
	| { kind: "already_purchased" };

// Purchases and their holds, kept in Postgres. The commit checks the stock and writes the purchase in one transaction, so
// Postgres has the last word on who got the item.
export type PurchaseRepository = {
	// The purchase made with this reservation id, if any.
	findByReservation(reservationId: string): Promise<Purchase | undefined>;
	// The purchase of this shopper in this sale, if any.
	findByUser(saleId: string, user: Username): Promise<Purchase | undefined>;
	// The reservation of this user, with any expiry. The service decides what an old one means.
	findReservation(
		saleId: string,
		user: Username,
	): Promise<Reservation | undefined>;
	// Turns a hold into a purchase in one transaction under a lock on the sale row. The lock makes the stock check and
	// the write one step, so the sale cannot oversell.
	commit(input: CommitInput): Promise<CommitResult>;
};
