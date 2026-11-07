// The queue as the rules see it: where a shopper stands in the line for one sale.

// Where a user stands in the queue of one sale. `waiting` has a place in the line, `admitted` may reserve now, and
// `absent` is not in the queue at all.
export type QueuePlace =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };
