import type {
	Purchase,
	PurchaseRepository,
} from "../../purchases/purchase-repository.js";
import type { ReservationRow } from "../../reservations/reservation-repository.js";
import type { Sale } from "../../sales/sale.js";

export type MemoryPurchaseRepository = PurchaseRepository & {
	purchases: Purchase[];
	buyersOf: (saleId: string) => string[];
	// Another instance sold an item: the same effect as a committed purchase.
	sellTo: (saleId: string, user: string) => void;
};

// Purchases in memory, for unit tests. `commit` follows the transaction in the Postgres repository.
export function memoryPurchaseRepository(
	sales: Sale[],
	reservations: Map<string, ReservationRow>,
): MemoryPurchaseRepository {
	const repository: MemoryPurchaseRepository = {
		purchases: [],
		buyersOf: (saleId) =>
			repository.purchases
				.filter((purchase) => purchase.saleId === saleId)
				.map((purchase) => purchase.user),

		sellTo(saleId, user) {
			const sale = sales.find((candidate) => candidate.id === saleId);
			if (sale) sale.sold += 1;
			repository.purchases.push({
				id: crypto.randomUUID(),
				saleId,
				user,
				reservationId: crypto.randomUUID(),
				paymentRef: `pay-${user}`,
				purchasedAt: new Date(),
			});
		},

		async findByReservation(reservationId) {
			return repository.purchases.find(
				(purchase) => purchase.reservationId === reservationId,
			);
		},

		async findByUser(saleId, user) {
			return repository.purchases.find(
				(purchase) => purchase.saleId === saleId && purchase.user === user,
			);
		},

		async findReservation(saleId, user) {
			return reservations.get(`${saleId}:${user}`);
		},

		async commit(input) {
			const same = await repository.findByReservation(input.reservationId);
			if (same) return { kind: "purchased", purchase: same, created: false };
			if (await repository.findByUser(input.saleId, input.user)) {
				return { kind: "already_purchased" };
			}
			const sale = sales.find((candidate) => candidate.id === input.saleId);
			if (!sale || sale.sold >= sale.stock) return { kind: "sold_out" };
			sale.sold += 1;
			const purchase: Purchase = {
				id: crypto.randomUUID(),
				saleId: input.saleId,
				user: input.user,
				reservationId: input.reservationId,
				paymentRef: input.paymentRef,
				purchasedAt: new Date(),
			};
			repository.purchases.push(purchase);
			reservations.delete(`${input.saleId}:${input.user}`);
			return { kind: "purchased", purchase, created: true };
		},
	};
	return repository;
}
