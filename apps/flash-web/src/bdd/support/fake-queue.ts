// The fake flash-be's queue route: a shopper joins the line for the sale, and is either admitted at once or given a place.
// Test support only.
import { type Reply, refuse, reply } from "./fake-http";
import {
	changed,
	type FakeState,
	limited,
	placeOf,
	statusOf,
	ticketOf,
} from "./fake-state";

// Joins the line. A shopper who is already in it gets the same place back, with 200 rather than 201.
export function join(state: FakeState, user: string): Reply {
	const wait = limited(state, user);
	if (wait) return wait;
	if (!state.sale) return refuse("sale_not_found");
	const status = statusOf(state);
	if (status === "ended") return refuse("sale_ended");
	if (status === "sold_out") return refuse("sold_out");
	const known = placeOf(state, user).state !== "absent";
	if (!known) {
		// With slow admission the shopper waits in line; otherwise the line admits them at once.
		if (state.settings.slowAdmission) state.waiting.push(user);
		else state.admitted.add(user);
		changed(state);
	}
	return reply(known ? 200 : 201, {
		userId: user,
		ticket: ticketOf(user),
		...placeOf(state, user),
	});
}

// Scenario setup: puts `count` other shoppers ahead in the line. They are never admitted.
export function queueAhead(state: FakeState, count: number) {
	for (let index = 0; index < count; index++) {
		state.waiting.push(`shopper${index}`);
	}
	changed(state);
}
