// A hold: one shopper's claim on one item of a sale, and the answers the fast gate and the source of truth give when
// asked for one. Domain layer: no I/O. The rules here decide what a reservation answers, and the stores only read the
// state the rules need and write what they decide.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { hasRoom, type Sale } from "./sale.js";
import { isLive } from "./time.js";
import type { Username } from "./user.js";

// The hold as the stores keep it. The purchase checks its id, and the rules check its end time.
export type Reservation = {
	saleId: string;
	user: Username;
	reservationId: string;
	expiresAt: Date;
};

// Everything the rules need to decide one reservation. The caller passes `now`, so the rules read no clock.
export type ReserveRequest = {
	saleId: string;
	user: Username;
	reservationId: string;
	now: Date;
	expiresAt: Date;
	stock: number;
};

// The fast gate's answer to one reserve request. Every kind but `not_ready` is final.
export type GateAnswer =
	| { kind: "reserved"; reservationId: string; expiresAt: Date }
	// The user already holds an item: the same answer comes back, so a retry is safe.
	| { kind: "held"; reservationId: string; expiresAt: Date }
	// The user already bought in this sale, so they may not hold again.
	| { kind: "purchased" }
	| { kind: "sold_out" }
	// The fast store has no reservation state for this sale (it was lost or never built). Rebuild it from the
	// source of truth.
	| { kind: "not_ready" };

// The answer when Postgres decides alone, because the fast store is down. `gate_ready` means the store is back, so use
// the gate. `sale_not_found` means the sale was removed during the request.
export type FallbackAnswer =
	| GateAnswer
	| { kind: "gate_ready" }
	| { kind: "sale_not_found" };

// The state a rebuild copies into the fast store: who bought, and who holds an item right now.
export type HoldSnapshot = {
	buyers: Username[];
	holds: Array<{ user: Username; reservationId: string; expiresAt: Date }>;
};

// What the stores know about one shopper and one sale when a reservation is decided. The store reads it under the sale's
// lock, so no other reservation can change it in between.
export type ReservationState = {
	sold: number;
	purchased: boolean;
	// This shopper's own hold in the sale, live or not: the rule decides whether it still counts.
	ownHold: { reservationId: string; expiresAt: Date } | undefined;
	// Live holds of the others. The shopper's own hold is not counted here.
	othersHolding: number;
};

// The answers a decision can give. `not_ready` is left out: only the fast store can have no state.
export type ReserveDecision = Exclude<GateAnswer, { kind: "not_ready" }>;

// The part of the state that needs only the shopper. The early answers use it, so they need no count.
export type ShopperState = Pick<ReservationState, "purchased" | "ownHold">;

// The part of the state that needs a count. Only the stock check reads it, after the early answers.
export type StockState = Pick<ReservationState, "sold" | "othersHolding">;

// The early answers, which need only the shopper's own state: a purchase, then the shopper's live hold. The Postgres
// fallback asks these first, so a buyer or a holder costs no count. Undefined when the stock decides.
export function earlyReservationAnswer(
	shopper: ShopperState,
	request: ReserveRequest,
): ReserveDecision | undefined {
	if (shopper.purchased) return { kind: "purchased" };
	if (shopper.ownHold && isLive(shopper.ownHold, request.now)) {
		return {
			kind: "held",
			reservationId: shopper.ownHold.reservationId,
			expiresAt: shopper.ownHold.expiresAt,
		};
	}
	return undefined;
}

// The stock answer. It runs only when the early answers gave none, so the count is taken only when it is needed.
export function roomReservationAnswer(
	stock: StockState,
	request: ReserveRequest,
): ReserveDecision {
	if (!hasRoom(stock.sold, stock.othersHolding, request.stock)) {
		return { kind: "sold_out" };
	}
	return {
		kind: "reserved",
		reservationId: request.reservationId,
		expiresAt: request.expiresAt,
	};
}

// The order every store follows: the early answers, then the stock. The Redis script (RESERVE in redis-hold-gate.ts)
// makes the same decision in Lua, so keep the two in step. The Postgres fallback calls the two steps itself, to skip the count.
export function decideReservation(
	state: ReservationState,
	request: ReserveRequest,
): ReserveDecision {
	return (
		earlyReservationAnswer(state, request) ??
		roomReservationAnswer(state, request)
	);
}

// The reserve request for one item. The hold length comes from the sale, so a shopper cannot choose it.
export function holdRequest(
	sale: Sale,
	user: Username,
	reservationId: string,
	now: Date,
): ReserveRequest {
	return {
		saleId: sale.id,
		user,
		reservationId,
		now,
		expiresAt: new Date(now.getTime() + sale.holdSeconds * MS_PER_SECOND),
		stock: sale.stock,
	};
}
