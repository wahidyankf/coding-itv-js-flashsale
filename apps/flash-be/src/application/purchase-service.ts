import { isPurchaseOf, type Purchase } from "../domain/purchase.js";
import { isLive } from "../domain/reservation.js";
import { isSaleId } from "../domain/sale.js";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { HoldGate } from "./ports/hold-gate.js";
import type { Payment } from "./ports/payment.js";
import type { PurchaseRepository } from "./ports/purchase-repository.js";
import type { SaleService } from "./sale-service.js";

export type ConfirmError =
	| "sale_not_found"
	| "invalid_user"
	| "invalid_reservation"
	| "reservation_not_found"
	| "hold_expired"
	| "already_purchased"
	| "sale_ended"
	| "sold_out"
	| "payment_failed";

export type ConfirmResult =
	| { ok: true; created: boolean; purchase: Purchase }
	| { ok: false; error: ConfirmError };

export type Outcome =
	| { state: "purchased"; purchase: Purchase }
	| { state: "holding"; reservationId: string; expiresAt: Date }
	| { state: "none" };

export type PurchaseService = ReturnType<typeof createPurchaseService>;

export function createPurchaseService(
	repository: PurchaseRepository,
	payment: Payment,
	gate: HoldGate,
	sales: SaleService,
	clock: Clock,
) {
	return {
		// Pays for a held item. The reservation id is the idempotency key: confirming again returns the same purchase.
		async confirm(
			saleId: string,
			rawUser: unknown,
			reservationId: unknown,
		): Promise<ConfirmResult> {
			const found = await sales.details(saleId);
			if (!found) return { ok: false, error: "sale_not_found" };
			const user = normalizeUser(rawUser);
			if (!user) return { ok: false, error: "invalid_user" };
			if (typeof reservationId !== "string" || !isSaleId(reservationId)) {
				return { ok: false, error: "invalid_reservation" };
			}

			const same = await repository.findByReservation(reservationId);
			if (same) {
				return isPurchaseOf(same, saleId, user)
					? { ok: true, created: false, purchase: same }
					: { ok: false, error: "reservation_not_found" };
			}
			if (await repository.findByUser(saleId, user)) {
				return { ok: false, error: "already_purchased" };
			}
			if (found.view.status === "ended") {
				return { ok: false, error: "sale_ended" };
			}

			const hold = await repository.findReservation(saleId, user);
			if (!hold || hold.reservationId !== reservationId) {
				return { ok: false, error: "reservation_not_found" };
			}
			if (!isLive(hold, clock())) return { ok: false, error: "hold_expired" };

			// The hold is checked before the charge. If it runs out during the charge, the database decides below.
			const charge = await payment.charge(reservationId);
			if (!charge.ok) return { ok: false, error: "payment_failed" };

			const result = await repository.commit({
				saleId,
				user,
				reservationId,
				paymentRef: charge.ref,
			});
			if (result.kind !== "purchased") {
				await payment.refund(charge.ref);
				return { ok: false, error: result.kind };
			}

			// Redis learns about the purchase after the commit. If this fails, a rebuild from Postgres fixes it.
			await gate.confirm(saleId, user).catch(() => {});
			return { ok: true, created: result.created, purchase: result.purchase };
		},

		// "Did I get it?": a purchase, a live hold, or nothing.
		async outcome(
			saleId: string,
			rawUser: unknown,
		): Promise<
			| { ok: true; user: string; outcome: Outcome }
			| { ok: false; error: "sale_not_found" | "invalid_user" }
		> {
			if (!(await sales.byId(saleId))) {
				return { ok: false, error: "sale_not_found" };
			}
			const user = normalizeUser(rawUser);
			if (!user) return { ok: false, error: "invalid_user" };

			const purchase = await repository.findByUser(saleId, user);
			if (purchase)
				return { ok: true, user, outcome: { state: "purchased", purchase } };
			const hold = await repository.findReservation(saleId, user);
			if (hold && isLive(hold, clock())) {
				return {
					ok: true,
					user,
					outcome: {
						state: "holding",
						reservationId: hold.reservationId,
						expiresAt: hold.expiresAt,
					},
				};
			}
			return { ok: true, user, outcome: { state: "none" } };
		},
	};
}
