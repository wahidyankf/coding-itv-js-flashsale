export type Purchase = {
	id: string;
	saleId: string;
	user: string;
	reservationId: string;
	paymentRef: string;
	purchasedAt: Date;
};
