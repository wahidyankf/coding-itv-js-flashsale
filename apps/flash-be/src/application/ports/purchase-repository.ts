import type { Purchase } from "../../domain/purchase.js";
import type { Reservation } from "../../domain/reservation.js";

export type CommitInput = {
	saleId: string;
	user: string;
	reservationId: string;
	paymentRef: string;
};

export type CommitResult =
	| { kind: "purchased"; purchase: Purchase; created: boolean }
	| { kind: "sold_out" }
	| { kind: "already_purchased" };

export type PurchaseRepository = {
	findByReservation(reservationId: string): Promise<Purchase | undefined>;
	findByUser(saleId: string, user: string): Promise<Purchase | undefined>;
	// The reservation of this user, with any expiry. The service decides what an old one means.
	findReservation(
		saleId: string,
		user: string,
	): Promise<Reservation | undefined>;
	// Turns a hold into a purchase in one transaction under a lock on the sale row.
	commit(input: CommitInput): Promise<CommitResult>;
};
