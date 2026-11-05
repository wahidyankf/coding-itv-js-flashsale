import {
	attemptAsync,
	Err,
	Ok,
	type Option,
	option,
	pipe,
	type Result,
	result,
} from "@flash/typekit";
import { isPurchaseOf, type Purchase } from "../domain/purchase.js";
import { isLive } from "../domain/reservation.js";
import { isSaleId } from "../domain/sale.js";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { HoldGate } from "./ports/hold-gate.js";
import type { Payment } from "./ports/payment.js";
import type { PurchaseRepository } from "./ports/purchase-repository.js";
import type { SaleDetails, SaleService } from "./sale-service.js";

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

export type Confirmed = { created: boolean; purchase: Purchase };

export type ConfirmResult = Result<Confirmed, ConfirmError>;

export type Outcome =
	| { state: "purchased"; purchase: Purchase }
	| { state: "holding"; reservationId: string; expiresAt: Date }
	| { state: "none" };

export type OutcomeError = "sale_not_found" | "invalid_user";

export type OutcomeResult = Result<
	{ user: string; outcome: Outcome },
	OutcomeError
>;

type Request = { details: SaleDetails; user: string; reservationId: string };

// What a confirmation must be before any store is asked: a known sale, a usable name and a well-formed reservation id.
function wellFormed(
	found: Option<SaleDetails>,
	rawUser: unknown,
	reservationId: unknown,
): Result<Request, ConfirmError> {
	return pipe(
		found,
		option.okOr<SaleDetails, ConfirmError>("sale_not_found"),
		result.flatMap((details: SaleDetails) =>
			pipe(
				normalizeUser(rawUser),
				option.okOr<string, ConfirmError>("invalid_user"),
				result.map((user: string) => ({ details, user })),
			),
		),
		result.flatMap(({ details, user }) =>
			typeof reservationId === "string" && isSaleId(reservationId)
				? new Ok({ details, user, reservationId })
				: new Err<Request, ConfirmError>("invalid_reservation"),
		),
	);
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
				return isPurchaseOf(same.value, saleId, user)
					? new Ok({ created: false, purchase: same.value })
					: new Err("reservation_not_found");
			}
			if (await repository.findByUser(saleId, user)) {
				return new Err("already_purchased");
			}
			if (details.view.status === "ended") return new Err("sale_ended");

			const hold = await repository.findReservation(saleId, user);
			if (!hold || hold.value.reservationId !== held) {
				return new Err("reservation_not_found");
			}
			if (!isLive(hold.value, clock())) return new Err("hold_expired");

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
			const known = pipe(
				await sales.byId(saleId),
				option.okOr<unknown, OutcomeError>("sale_not_found"),
				result.flatMap(() =>
					pipe(
						normalizeUser(rawUser),
						option.okOr<string, OutcomeError>("invalid_user"),
					),
				),
			);
			if (known.isErr()) return new Err(known.error);
			const user = known.value;

			const purchase = await repository.findByUser(saleId, user);
			if (purchase) {
				return new Ok({
					user,
					outcome: { state: "purchased", purchase: purchase.value },
				});
			}
			const hold = await repository.findReservation(saleId, user);
			if (hold && isLive(hold.value, clock())) {
				return new Ok({
					user,
					outcome: {
						state: "holding",
						reservationId: hold.value.reservationId,
						expiresAt: hold.value.expiresAt,
					},
				});
			}
			return new Ok({ user, outcome: { state: "none" } });
		},
	};
}
