// The line of shoppers for one sale, and who the queue has admitted. It is fast shared state: Redis keeps it so every
// instance sees one line. If it is lost, shoppers are let through (see queue-service).
import type { QueuePlace } from "../../domain/queue.js";
import type { Username } from "../../domain/user.js";

export type QueueStore = {
	// Adds the shopper at the end of the line, unless they already wait or were admitted. `created` is true only for a
	// new place.
	join(
		saleId: string,
		user: Username,
		now: Date,
	): Promise<{ place: QueuePlace; created: boolean }>;
	// Where the shopper stands now.
	place(saleId: string, user: Username, now: Date): Promise<QueuePlace>;
	// Moves the first `count` waiting shoppers to admitted, each for `ttlSeconds`. Returns who was admitted.
	admit(
		saleId: string,
		count: number,
		now: Date,
		ttlSeconds: number,
	): Promise<Username[]>;
	// Only one instance may admit in a given tick, so the line moves at the sale's rate and not faster. True when this
	// caller holds that right for `ms`.
	tryLead(saleId: string, ms: number): Promise<boolean>;
};
