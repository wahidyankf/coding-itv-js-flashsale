import type { QueuePlace } from "../../domain/queue.js";

// The queue state sits behind this port. Redis holds it in production; unit tests use a memory copy.
export type QueueStore = {
	// Adds the user at the end unless they already wait or were admitted. `created` is true only for a new place.
	join(
		saleId: string,
		user: string,
		now: Date,
	): Promise<{ place: QueuePlace; created: boolean }>;
	place(saleId: string, user: string, now: Date): Promise<QueuePlace>;
	// Moves the first `count` waiting users to admitted, each valid for `ttlSeconds`. Returns who was admitted.
	admit(
		saleId: string,
		count: number,
		now: Date,
		ttlSeconds: number,
	): Promise<string[]>;
	// Only one instance may admit in a given tick. True when this caller holds the right for `ms`.
	tryLead(saleId: string, ms: number): Promise<boolean>;
};
