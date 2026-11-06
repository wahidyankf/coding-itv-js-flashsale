import type {
	CONFIRM_ERRORS,
	OUTCOME_ERRORS,
} from "@flash/contract/vocabulary";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { isPurchaseOf, type Purchase } from "../domain/purchase.js";
import { isLive } from "../domain/reservation.js";
import { isSaleId } from "../domain/sale.js";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { HoldGate } from "./ports/hold-gate.js";
import type { Payment } from "./ports/payment.js";
import type { PurchaseRepository } from "./ports/purchase-repository.js";
import type { SaleDetails, SaleService } from "./sale-service.js";

export type ConfirmError = (typeof CONFIRM_ERRORS)[number];

export type Confirmed = { created: boolean; purchase: Purchase };

export type ConfirmResult = Result<Confirmed, ConfirmError>;

export type Outcome =
	| { state: "purchased"; purchase: Purchase }
	| { state: "holding"; reservationId: string; expiresAt: Date }
	| { state: "none" };

export type OutcomeError = (typeof OUTCOME_ERRORS)[number];

export type OutcomeResult = Result<
	{ user: string; outcome: Outcome },
	OutcomeError
>;

type Request = { details: SaleDetails; user: string; reservationId: string };

// What a confirmation must be before any store is asked: a known sale, a usable name and a well-formed reservation id.
function wellFormed(
	found: SaleDetails | undefined,
	rawUser: unknown,
	reservationId: unknown,
): Result<Request, ConfirmError> {
	if (found === undefined) return new Err("sale_not_found");
	const user = normalizeUser(rawUser);
	if (user === undefined) return new Err("invalid_user");
	if (typeof reservationId !== "string" || !isSaleId(reservationId)) {
		return new Err("invalid_reservation");
	}
	return new Ok({ details: found, user, reservationId });
}

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
			const request = wellFormed(
				await sales.details(saleId),
				rawUser,
				reservationId,
			);
			if (request.isErr()) return new Err(request.error);
			const { details, user, reservationId: held } = request.value;

			const same = await repository.findByReservation(held);
			if (same) {
				return isPurchaseOf(same, saleId, user)
					? new Ok({ created: false, purchase: same })
					: new Err("reservation_not_found");
			}
			if (await repository.findByUser(saleId, user)) {
				return new Err("already_purchased");
			}
			if (details.view.status === "ended") return new Err("sale_ended");

			const hold = await repository.findReservation(saleId, user);
			if (!hold || hold.reservationId !== held) {
				return new Err("reservation_not_found");
			}
			if (!isLive(hold, clock())) return new Err("hold_expired");

			// The hold is checked before the charge. If it runs out during the charge, the database decides below.
			const charge = await payment.charge(held);
			if (charge.isErr()) return new Err("payment_failed");
			const { ref } = charge.value;

			const committed = await repository.commit({
				saleId,
				user,
				reservationId: held,
				paymentRef: ref,
			});
			if (committed.kind !== "purchased") {
				await payment.refund(ref);
				return new Err(committed.kind);
			}

			// Redis learns about the purchase after the commit. If this fails, a rebuild from Postgres fixes it.
			await attemptAsync(() => gate.confirm(saleId, user), Error);
			return new Ok({
				created: committed.created,
				purchase: committed.purchase,
			});
		},

		// "Did I get it?": a purchase, a live hold, or nothing.
		async outcome(saleId: string, rawUser: unknown): Promise<OutcomeResult> {
			if ((await sales.byId(saleId)) === undefined) {
				return new Err("sale_not_found");
			}
			const user = normalizeUser(rawUser);
			if (user === undefined) return new Err("invalid_user");

			const purchase = await repository.findByUser(saleId, user);
			if (purchase) {
				return new Ok({ user, outcome: { state: "purchased", purchase } });
			}
			const hold = await repository.findReservation(saleId, user);
			if (hold && isLive(hold, clock())) {
				return new Ok({
					user,
					outcome: {
						state: "holding",
						reservationId: hold.reservationId,
						expiresAt: hold.expiresAt,
					},
				});
			}
			return new Ok({ user, outcome: { state: "none" } });
		},
	};
}
