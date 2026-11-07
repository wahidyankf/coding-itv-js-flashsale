// A hold: one shopper's claim on one item of a sale, and the answers the fast gate and the source of truth give when
// asked for one. Domain layer: no I/O. The rules here decide what a reservation answers, and the stores only read the
// state the rules need and write what they decide.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { hasRoom, type Sale } from "./sale.js";
import { isLive } from "./time.js";
import type { Username } from "./user.js";

// The hold one shopper has on one item of a sale.
export type Reservation = {
	saleId: string;
	user: Username;
	reservationId: string;
	expiresAt: Date;
};

// Everything needed to decide one reservation.
export type ReserveRequest = {
	saleId: string;
	user: Username;
	reservationId: string;
	now: Date;
	expiresAt: Date;
	stock: number;
};

// The answer of the fast gate to one reserve request.
export type GateAnswer =
	// A new hold was written.
	| { kind: "reserved"; reservationId: string; expiresAt: Date }
	// The user already holds an item: the same answer comes back, so a retry is safe.
	| { kind: "held"; reservationId: string; expiresAt: Date }
	// The user already bought in this sale, so they may not hold again.
	| { kind: "purchased" }
	| { kind: "sold_out" }
	// The fast store has no reservation state for this sale (it was lost or never built). Rebuild it from the
	// source of truth.
	| { kind: "not_ready" };

// The answer when the fast store is down and the source of truth decides alone. `gate_ready` means the fast store is
// ready again, so the caller should use the gate instead. `sale_not_found` means the sale was removed while the request
// ran, so nothing is decided.
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
	// Items sold in the sale.
	sold: number;
	// Whether this shopper bought in the sale.
	purchased: boolean;
	// This shopper's own hold in the sale, live or not: the rule decides whether it still counts.
	ownHold: { reservationId: string; expiresAt: Date } | undefined;
	// Live holds of the other shoppers in the sale.
	othersHolding: number;
};

// The answers a decision can give. `not_ready` is left out: only the fast store can have no state.
export type ReserveDecision = Exclude<GateAnswer, { kind: "not_ready" }>;

// What a store reads about the shopper: whether they bought in the sale, and their own hold, live or not.
export type ShopperState = Pick<ReservationState, "purchased" | "ownHold">;

// What a store reads about the stock: the items sold, and the live holds of the other shoppers.
export type StockState = Pick<ReservationState, "sold" | "othersHolding">;

// The early answers, which need only the shopper's own state: a purchase first, then the shopper's own live hold. The
// Postgres fallback reads the shopper's state first and counts the other holds only when this gives no answer, so a
// buyer or a holder costs no count. Undefined when the stock decides.
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

// The answer of the stock, once the early answers gave none: a new hold while the sold items and the live holds of the
// others leave an item free, and sold out otherwise.
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

// The one order of the checks that every store follows: the early answers, then the stock. The Redis script (RESERVE in
// redis-hold-gate.ts) makes the same decision in Lua, because it runs in one call, so keep the two in step. The memory
// reservation repository calls this function; the Postgres fallback calls the two steps, so it can skip the count.
export function decideReservation(
	state: ReservationState,
	request: ReserveRequest,
): ReserveDecision {
	return (
		earlyReservationAnswer(state, request) ??
		roomReservationAnswer(state, request)
	);
}

// What a shopper asks for when they reserve: one item, held for the time the sale sets.
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
