// Purchases in memory for the unit layer. `commit` gives the answers the Postgres transaction gives: the same purchase
// for the same reservation, a refusal for a second purchase, and sold out when the stock is gone.
import type { PurchaseRepository } from "../../application/ports/purchase-repository.js";
import type { Purchase } from "../../domain/purchase.js";
import type { Reservation } from "../../domain/reservation.js";
import type { Sale } from "../../domain/sale.js";
import type { Username } from "../../domain/user.js";

// The purchase store of the unit layer, with the buyers of a sale and a way to record a sale made by another instance,
// so a scenario can prove a second instance cannot sell the same item.
export type MemoryPurchaseRepository = PurchaseRepository & {
	purchases: Purchase[];
	buyersOf: (saleId: string) => Username[];
	// Another instance sold an item: the same effect as a committed purchase.
	sellTo: (saleId: string, user: Username) => void;
};

// Purchases in memory, for unit tests. `commit` follows the transaction in the Postgres repository.
export function memoryPurchaseRepository(
	sales: Sale[],
	reservations: Map<string, Reservation>,
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
			if (same) {
				return { kind: "purchased", purchase: same, created: false };
			}
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
