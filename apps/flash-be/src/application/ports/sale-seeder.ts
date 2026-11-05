// A sale to create. The window is absolute; the seed command works it out from minutes.
export type NewSale = {
	name: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
	reservationTtlSeconds: number;
	admitPerSecond: number;
};
