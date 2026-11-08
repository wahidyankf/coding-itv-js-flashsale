// Kind: store (keyed state in Redis that a lost reply or outage can drop). Application layer, port. The line of shoppers
// for one sale, and who the queue has admitted. Redis keeps it, so every instance sees one line. If it is lost, shoppers
// are let through (see queue-service).
import type { Result } from "@flash/typekit";
import type { QueuePlace } from "../../domain/queue.js";
import type { Username } from "../../domain/user.js";
import type { UnreadableReply } from "./reply.js";

// The shared line behind a port: Redis in production, a memory double in tests, so no service reads a key itself.
export type QueueStore = {
	// Adds the shopper at the end of the line, unless they already wait or were admitted. `created` is true only for a
	// new place.
	join(
		saleId: string,
		user: Username,
		now: Date,
	): Promise<Result<{ place: QueuePlace; created: boolean }, UnreadableReply>>;
	// Where the shopper stands now.
	place(
		saleId: string,
		user: Username,
		now: Date,
	): Promise<Result<QueuePlace, UnreadableReply>>;
	// Moves the first `count` waiting shoppers to admitted, each for `ttlSeconds`. Returns who was admitted.
	admit(
		saleId: string,
		count: number,
		now: Date,
		ttlSeconds: number,
	): Promise<Result<Username[], UnreadableReply>>;
	// Only one instance may admit in a given tick, so the line moves at the sale's rate and not faster. True when this
	// caller holds that right for `ms`.
	tryLead(saleId: string, ms: number): Promise<boolean>;
};
