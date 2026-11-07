// The purchase use case (application layer): a shopper pays for the item their hold keeps, and asks whether they got it.
// The charge goes to the payment port. The commit is a transaction in Postgres, which has the last word on the stock;
// Redis is told after.
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import {
	holdRefusalOf,
	isPurchaseOf,
	type Outcome,
	outcomeOf,
	type Purchase,
} from "../domain/purchase.js";
import { confirmBlock, isSaleId, type Sale } from "../domain/sale.js";
import type { Username } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { HoldGate } from "./ports/hold-gate.js";
import type { Payment } from "./ports/payment.js";
import type {
	CommitResult,
	PurchaseRepository,
} from "./ports/purchase-repository.js";
import type { SaleService } from "./sale-service.js";

// Why a purchase is refused. Each one says which step of the flow failed, so a client can tell a retry from a stop.
export type ConfirmError =
	| "sale_not_found"
	| "invalid_reservation"
	| "reservation_not_found"
	| "hold_expired"
	| "already_purchased"
	| "sale_ended"
	| "sold_out"
	| "payment_failed";

// `created` is false when the same reservation was already paid for: the shopper gets the same purchase back.
export type Confirmed = { created: boolean; purchase: Purchase };

// A purchase, or the reason it was refused. A refusal is a value, so the route can map it to its status.
export type ConfirmResult = Result<Confirmed, ConfirmError>;

// Only a missing sale is an error here. A shopper with no purchase or hold has an answer, not a failure.
export type OutcomeError = "sale_not_found";

// The shopper's outcome in the sale, or the reason there is none to give.
export type OutcomeResult = Result<
	{ user: Username; outcome: Outcome },
	OutcomeError
>;

// The purchase use case as the HTTP adapter calls it. A refusal is a value; a failing store throws, and the route answers 500.
export type PurchaseService = {
	// Pays for a held item. The reservation id is the idempotency key: confirming again returns the same purchase.
	confirm: (
		saleId: string,
		user: Username,
		reservationId: unknown,
	) => Promise<ConfirmResult>;
	// "Did I get it?": a purchase, a live hold, or nothing.
	outcome: (saleId: string, user: Username) => Promise<OutcomeResult>;
};

// The first check of a confirmation: the sale exists and the reservation id is well formed. The text is checked as an
// id, because it arrives from a client and is only ever looked up.
function wellFormed(
	found: Sale | undefined,
	reservationId: unknown,
): Result<{ sale: Sale; reservationId: string }, ConfirmError> {
	if (found === undefined) return new Err("sale_not_found");
	if (typeof reservationId !== "string" || !isSaleId(reservationId)) {
		return new Err("invalid_reservation");
	}
	return new Ok({ sale: found, reservationId });
}

// Wires the purchase use case over its ports, so a test can put a fake payment or gate behind it.
export function createPurchaseService(
	repository: PurchaseRepository,
	payment: Payment,
	gate: HoldGate,
	sales: SaleService,
	clock: Clock,
): PurchaseService {
	// A reservation that was already paid for answers with its purchase again, so a retry is safe. It answers "not found"
	// when the purchase is someone else's. Returns nothing when this reservation was never paid for.
	async function paidEarlier(
		saleId: string,
		user: Username,
		reservationId: string,
	): Promise<ConfirmResult | undefined> {
		const same = await repository.findByReservation(reservationId);
		if (same === undefined) return undefined;
		return isPurchaseOf(same, saleId, user)
			? new Ok({ created: false, purchase: same })
			: new Err("reservation_not_found");
	}

	// Charges the hold, then writes the purchase in the database. A declined charge ends here. A commit that finds the sale
	// sold out, or the shopper already bought, refunds the charge. A commit that fails after the charge refunds it too, and
	// the failure goes on to the caller as before.
	async function chargeAndCommit(
		saleId: string,
		user: Username,
		reservationId: string,
	): Promise<ConfirmResult> {
		// The hold is checked before the charge and not again after it. A hold that runs out while the provider works is
		// not a failure: an item still free is sold. See docs/explanation/payment-and-refunds.md, "When the hold ends during
		// the payment".
		const charge = await payment.charge(reservationId);
		if (charge.isErr()) return new Err("payment_failed");
		const { ref } = charge.value;

		const committed = await attemptAsync(
			() =>
				repository.commit({
					saleId,
					user,
					reservationId,
					paymentRef: ref,
				}),
			Error,
		);
		if (committed.isErr()) {
			await payment.refund(ref);
			throw committed.error;
		}
		const result: CommitResult = committed.value;
		if (result.kind !== "purchased") {
			await payment.refund(ref);
			return new Err(result.kind);
		}

		// Redis learns about the purchase after the commit. If this fails, a rebuild from Postgres fixes it.
		await attemptAsync(() => gate.confirm(saleId, user), Error);
		return new Ok({ created: result.created, purchase: result.purchase });
	}

	return {
		async confirm(saleId, user, reservationId) {
			const request = wellFormed(await sales.details(saleId), reservationId);
			if (request.isErr()) return new Err(request.error);
			const held = request.value.reservationId;

			const earlier = await paidEarlier(saleId, user, held);
			if (earlier !== undefined) return earlier;
			if (await repository.findByUser(saleId, user)) {
				return new Err("already_purchased");
			}
			const ended = confirmBlock(request.value.sale, clock());
			if (ended !== undefined) return new Err(ended);
			const hold = await repository.findReservation(saleId, user);
			const refused = holdRefusalOf(hold, held, clock());
			if (refused !== undefined) return new Err(refused);

			return chargeAndCommit(saleId, user, held);
		},

		async outcome(saleId, user) {
			if ((await sales.byId(saleId)) === undefined) {
				return new Err("sale_not_found");
			}
			const purchase = await repository.findByUser(saleId, user);
			const hold = await repository.findReservation(saleId, user);
			return new Ok({ user, outcome: outcomeOf(purchase, hold, clock()) });
		},
	};
}
