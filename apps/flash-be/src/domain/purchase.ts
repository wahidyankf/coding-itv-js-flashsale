export type Purchase = {
	id: string;
	saleId: string;
	user: string;
	reservationId: string;
	paymentRef: string;
	purchasedAt: Date;
};

// A reservation id is the key of a purchase. Only the shopper and the sale it was made for may ask for it again.
export function isPurchaseOf(
	purchase: Purchase,
	saleId: string,
	user: string,
): boolean {
	return purchase.user === user && purchase.saleId === saleId;
}
