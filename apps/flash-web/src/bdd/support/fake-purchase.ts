// The fake flash-be's purchase routes: take a hold on an item, pay for the hold, and say whether a shopper has bought.
// Each route first checks what would refuse it, then does its one step. Test support only.
import { MS_PER_SECOND } from "@flash/flash-commons";
import { type Reply, refuse, reply } from "./fake-http";
import {
	changed,
	type FakeState,
	isoOf,
	limited,
	liveHoldCount,
	statusOf,
	ticketOf,
} from "./fake-state";

// The first refusal that applies to a hold, or undefined when the shopper may take one.
function reserveRefusal(
	state: FakeState,
	user: string,
	ticket: string | undefined,
): Reply | undefined {
	const wait = limited(state, user);
	if (wait) return wait;
	if (!state.sale) return refuse("sale_not_found");
	const status = statusOf(state);
	if (status === "upcoming") return refuse("sale_not_started");
	if (status === "ended") return refuse("sale_ended");
	if (status === "sold_out") return refuse("sold_out");
	if (ticket !== ticketOf(user)) return refuse("invalid_ticket");
	// The admission can run out between the join and the hold, as its time does; the fake ends it here.
	if (state.settings.admissionEnds) state.admitted.delete(user);
	if (!state.admitted.has(user)) return refuse("not_admitted");
	if (state.bought.has(user)) return refuse("already_purchased");
	return undefined;
}

// Takes a hold for an admitted shopper. A shopper who already holds one keeps the same hold.
export function reserve(
	state: FakeState,
	user: string,
	ticket: string | undefined,
): Reply {
	const refused = reserveRefusal(state, user, ticket);
	if (refused) return refused;
	const own = state.holds.get(user);
	if (own && own.expiresAt > state.now()) {
		return reply(200, {
			userId: user,
			reservationId: own.reservationId,
			expiresAt: isoOf(own.expiresAt),
		});
	}
	// Every item is either bought or on hold, so a hold is refused once none is left.
	if (state.bought.size + liveHoldCount(state) >= (state.sale?.stock ?? 0)) {
		return refuse("sold_out");
	}
	const hold = {
		reservationId: crypto.randomUUID(),
		expiresAt: state.now() + state.settings.holdSeconds * MS_PER_SECOND,
	};
	state.holds.set(user, hold);
	return reply(201, {
		userId: user,
		reservationId: hold.reservationId,
		expiresAt: isoOf(hold.expiresAt),
	});
}

// The first refusal that applies to paying for a hold, or undefined when the payment may go through.
function payRefusal(
	state: FakeState,
	user: string,
	reservationId: string,
): Reply | undefined {
	const hold = state.holds.get(user);
	if (!hold || hold.reservationId !== reservationId) {
		return refuse("reservation_not_found");
	}
	if (hold.expiresAt <= state.now()) return refuse("hold_expired");
	if (state.settings.paymentDeclines) return refuse("payment_failed");
	return undefined;
}

// Pays for a hold, and turns it into a purchase. Paying again for the same purchase is safe; anything else is refused.
export function confirm(
	state: FakeState,
	user: string,
	reservationId: string,
): Reply {
	const wait = limited(state, user);
	if (wait) return wait;
	const sale = state.sale;
	if (!sale) return refuse("sale_not_found");
	const earlier = state.bought.get(user);
	if (earlier) {
		return earlier.reservationId === reservationId
			? reply(200, { userId: user, ...earlier })
			: refuse("already_purchased");
	}
	const refused = payRefusal(state, user, reservationId);
	if (refused) return refused;
	const purchase = {
		purchaseId: crypto.randomUUID(),
		reservationId,
		purchasedAt: isoOf(state.now()),
	};
	state.bought.set(user, purchase);
	state.holds.delete(user);
	sale.sold += 1;
	changed(state);
	return reply(201, { userId: user, ...purchase });
}

// What the shopper has: a purchase, a live hold, or neither. The purchase is checked first.
export function outcome(state: FakeState, user: string): Reply {
	if (!state.sale) return refuse("sale_not_found");
	const purchase = state.bought.get(user);
	if (purchase) {
		return reply(200, { userId: user, ...purchase, state: "purchased" });
	}
	const hold = state.holds.get(user);
	if (hold && hold.expiresAt > state.now()) {
		return reply(200, {
			userId: user,
			state: "holding",
			reservationId: hold.reservationId,
			expiresAt: isoOf(hold.expiresAt),
		});
	}
	return reply(200, { userId: user, state: "none" });
}

// Scenario setup: the shopper is admitted and holds the last item.
export function giveHold(state: FakeState, user: string) {
	state.admitted.add(user);
	state.holds.set(user, {
		reservationId: crypto.randomUUID(),
		expiresAt: state.now() + state.settings.holdSeconds * MS_PER_SECOND,
	});
	changed(state);
}

// Scenario setup: the shopper has bought an item already, and it counts as sold.
export function giveItem(state: FakeState, user: string) {
	state.bought.set(user, {
		purchaseId: crypto.randomUUID(),
		reservationId: crypto.randomUUID(),
		purchasedAt: isoOf(state.now()),
	});
	if (state.sale) state.sale.sold += 1;
	changed(state);
}
