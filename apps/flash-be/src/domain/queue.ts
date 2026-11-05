// Where a user stands in the queue of one sale.
export type QueuePlace =
	| { state: "waiting"; place: number }
	| { state: "admitted" }
	| { state: "absent" };
