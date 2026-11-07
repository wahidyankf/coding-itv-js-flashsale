// The queue store in memory for the unit layer (test support): the waiting line, the admitted shoppers with the time each
// admission ends, and the lease one instance takes to admit. It follows the Redis queue store, and it answers with the
// same Results, which never fail here.
import { Ok } from "@flash/typekit";
import type { Clock } from "../../application/ports/clock.js";
import type { QueueStore } from "../../application/ports/queue-store.js";
import type { QueuePlace } from "../../domain/queue.js";
import type { Username } from "../../domain/user.js";

// The queue store of the unit layer. `clear` empties it, as losing Redis does, so a scenario can prove the queue recovers.
export type MemoryQueueStore = QueueStore & { clear: () => void };

// The queue state in memory, for unit tests. It follows the same rules as the Redis store.
export function memoryQueueStore(clock: Clock): MemoryQueueStore {
	const waiting = new Map<string, Username[]>();
	const admitted = new Map<string, Map<string, number>>();
	const leaseUntil = new Map<string, number>();

	const line = (saleId: string): Username[] => {
		let users = waiting.get(saleId);
		if (!users) {
			users = [];
			waiting.set(saleId, users);
		}
		return users;
	};
	const admissions = (saleId: string): Map<string, number> => {
		let users = admitted.get(saleId);
		if (!users) {
			users = new Map();
			admitted.set(saleId, users);
		}
		return users;
	};
	const placeOf = (saleId: string, user: Username, now: Date): QueuePlace => {
		const until = admissions(saleId).get(user);
		if (until !== undefined && until > now.getTime()) {
			return { state: "admitted" };
		}
		const index = line(saleId).indexOf(user);
		return index >= 0
			? { state: "waiting", place: index + 1 }
			: { state: "absent" };
	};

	return {
		clear: () => {
			waiting.clear();
			admitted.clear();
			leaseUntil.clear();
		},
		async join(saleId, user, now) {
			const place = placeOf(saleId, user, now);
			if (place.state !== "absent") {
				return new Ok({ place, created: false });
			}
			line(saleId).push(user);
			return new Ok({ place: placeOf(saleId, user, now), created: true });
		},
		async place(saleId, user, now) {
			return new Ok(placeOf(saleId, user, now));
		},
		async admit(saleId, count, now, ttlSeconds) {
			const next = line(saleId).splice(0, count);
			for (const user of next) {
				admissions(saleId).set(user, now.getTime() + ttlSeconds * 1000);
			}
			return new Ok(next);
		},
		async tryLead(saleId, ms) {
			const now = clock().getTime();
			if ((leaseUntil.get(saleId) ?? 0) > now) return false;
			leaseUntil.set(saleId, now + ms);
			return true;
		},
	};
}
