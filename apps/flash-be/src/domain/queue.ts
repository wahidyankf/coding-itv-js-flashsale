// The queue as the rules see it: where a shopper stands in the line for one sale, and who may reserve because of it.
// Domain layer: no I/O. The queue service reads the place from the store and asks these rules what it means.

// Where a user stands in the queue of one sale. `waiting` has a place in the line, `admitted` may reserve now, and
// `absent` is not in the queue at all.
export type QueuePlace =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };

// Why a shopper may not reserve now: they wait in the line, or they are not in it and not admitted. A shopper who
// bought is told so, because the queue can be lost and the purchase record is the proof.
export type ReserveRefusal = "not_admitted" | "already_purchased";

// The reason a shopper may not reserve, or nothing when they may. Only an admitted place reserves. A shopper outside
// the line gets `already_purchased` if they bought.
export function reserveRefusalOf(
	place: QueuePlace | undefined,
	bought: boolean,
): ReserveRefusal | undefined {
	if (place === undefined) return bought ? "already_purchased" : "not_admitted";
	return place.state === "admitted" ? undefined : "not_admitted";
}
