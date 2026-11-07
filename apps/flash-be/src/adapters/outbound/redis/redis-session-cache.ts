import { attemptAsync } from "@flash/typekit";
import type { SessionStore } from "../../../application/ports/session-store.js";
import { MS_PER_SECOND } from "../../../domain/time.js";
import type { RedisClient } from "./redis-client.js";

// How long an answer is kept, at most. A short time keeps a deleted user or a changed role from lingering.
const CACHE_SECONDS = 60;

type Cached = {
	principal: { userId: string; username: string; role: "shopper" | "operator" };
	expiresAt: string;
};

// Remembers who an access token belongs to, so a request does not read Postgres to be recognised. Postgres is the truth:
// a miss reads it, and so does a failing Redis. Logging out forgets the token here at once.
export function createCachedSessionStore(
	inner: SessionStore,
	redis: RedisClient,
): SessionStore {
	const keyOf = (accessHash: string) => `session:${accessHash}`;
	// A failed delete is not fatal: the entry ends by itself within the cache time.
	const forget = async (accessHashes: string[]) => {
		if (accessHashes.length === 0) return;
		await attemptAsync(() => redis.del(accessHashes.map(keyOf)), Error);
	};
	return {
		create: (session) => inner.create(session),

		async rotate(rotation) {
			const rotated = await inner.rotate(rotation);
			await forget(rotated.ended);
			return rotated;
		},

		async findByAccess(accessHash, now) {
			const hit = await attemptAsync(() => redis.get(keyOf(accessHash)), Error);
			if (hit.isOk() && hit.value !== null) {
				const cached = JSON.parse(hit.value) as Cached;
				return {
					principal: cached.principal,
					expiresAt: new Date(cached.expiresAt),
				};
			}
			const found = await inner.findByAccess(accessHash, now);
			if (found === undefined) return undefined;
			const secondsLeft = Math.floor(
				(found.expiresAt.getTime() - now.getTime()) / MS_PER_SECOND,
			);
			const ttl = Math.min(CACHE_SECONDS, secondsLeft);
			if (ttl > 0) {
				const value: Cached = {
					principal: found.principal,
					expiresAt: found.expiresAt.toISOString(),
				};
				// A failed write only costs the next request a read.
				await attemptAsync(
					() =>
						redis.set(keyOf(accessHash), JSON.stringify(value), { EX: ttl }),
					Error,
				);
			}
			return found;
		},

		async revoke(hashes) {
			const accessHashes = await inner.revoke(hashes);
			const forgotten = [
				...accessHashes,
				...(hashes.accessHash ? [hashes.accessHash] : []),
			];
			await forget(forgotten);
			return accessHashes;
		},
	};
}
