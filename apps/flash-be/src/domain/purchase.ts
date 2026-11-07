// A purchase is a hold that was paid for, and the "did I get it?" answer is a purchase, a live hold, or nothing.
import type { Reservation } from "./reservation.js";
import { isLive } from "./time.js";
import type { Username } from "./user.js";

// One shopper's paid item in one sale. `paymentRef` is what a refund names.
export type Purchase = {
	id: string;
	saleId: string;
	user: Username;
	reservationId: string;
	paymentRef: string;
	purchasedAt: Date;
};

// Where a shopper stands in one sale: they bought, they hold an item, or neither.
export type Outcome =
	| { state: "purchased"; purchase: Purchase }
	| { state: "holding"; reservationId: string; expiresAt: Date }
	| { state: "none" };

// Whether a purchase belongs to this shopper and this sale. Anyone else who asks for it gets the same answer as for an
// unknown reservation, so an id reveals nothing about another shopper.
export function isPurchaseOf(
	purchase: Purchase,
	saleId: string,
	user: Username,
): boolean {
	return purchase.user === user && purchase.saleId === saleId;
}

// The outcome for a shopper: a purchase comes first, then a hold that is still live, then nothing. An old hold is not
// shown, because it no longer keeps the item.
export function outcomeOf(
	purchase: Purchase | undefined,
	hold: Reservation | undefined,
	now: Date,
): Outcome {
	if (purchase) return { state: "purchased", purchase };
	if (hold && isLive(hold, now)) {
		return {
			state: "holding",
			reservationId: hold.reservationId,
			expiresAt: hold.expiresAt,
		};
	}
	return { state: "none" };
}
