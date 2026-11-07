// The queue store in memory for the unit layer: the waiting line, the admitted shoppers with the time each admission
// ends, and the lease one instance takes to admit. It follows the Redis queue store.
import type { Clock } from "../../application/ports/clock.js";
import type { QueueStore } from "../../application/ports/queue-store.js";
import type { QueuePlace } from "../../domain/queue.js";

// The queue state in memory, for unit tests. It follows the same rules as the Redis store.
export type MemoryQueueStore = QueueStore & { clear: () => void };

export function memoryQueueStore(clock: Clock): MemoryQueueStore {
	const waiting = new Map<string, string[]>();
	const admitted = new Map<string, Map<string, number>>();
	const leaseUntil = new Map<string, number>();

	const line = (saleId: string): string[] => {
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
	const placeOf = (saleId: string, user: string, now: Date): QueuePlace => {
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
			if (place.state !== "absent") return { place, created: false };
			line(saleId).push(user);
			return { place: placeOf(saleId, user, now), created: true };
		},
		async place(saleId, user, now) {
			return placeOf(saleId, user, now);
		},
		async admit(saleId, count, now, ttlSeconds) {
			const next = line(saleId).splice(0, count);
			for (const user of next) {
				admissions(saleId).set(user, now.getTime() + ttlSeconds * 1000);
			}
			return next;
		},
		async tryLead(saleId, ms) {
			const now = clock().getTime();
			if ((leaseUntil.get(saleId) ?? 0) > now) return false;
			leaseUntil.set(saleId, now + ms);
			return true;
		},
	};
}
