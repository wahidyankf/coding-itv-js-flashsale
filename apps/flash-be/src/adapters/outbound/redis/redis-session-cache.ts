// The login cache in Redis, placed in front of the session store. It answers an access token without a Postgres read,
// for a minute at most. Postgres stays the truth: a miss, a failing Redis or an entry that cannot be read all fall back
// to it (see decision 007 for why logins are kept in Postgres at all).
import { attempt, attemptAsync } from "@flash/typekit";
import type { SessionStore } from "../../../application/ports/session-store.js";
import type { Principal } from "../../../domain/auth.js";
import { MS_PER_SECOND } from "../../../domain/time.js";
import type { RedisClient } from "./redis-client.js";

// How long an answer is kept, at most. A short time keeps a deleted user or a changed role from lingering.
const CACHE_SECONDS = 60;

// What is kept for one token: who it belongs to, and when the login ends, as ISO text because JSON has no dates.
type Cached = {
	principal: Principal;
	expiresAt: string;
};

// The cached text read back as a login. A broken entry is a failure to read, not a crash.
const readCached = (text: string) =>
	attempt(() => JSON.parse(text) as Cached, SyntaxError);

// Remembers who an access token belongs to, so a request does not read Postgres to be recognised. Postgres is the truth:
// a miss reads it, and so does a failing Redis. Logging out forgets the token here at once.
export function createRedisSessionCache(
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
				const cached = readCached(hit.value);
				if (cached.isOk()) {
					return {
						principal: cached.value.principal,
						expiresAt: new Date(cached.value.expiresAt),
					};
				}
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
