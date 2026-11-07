// The rate limit use case: how many write requests one shopper, one address, or one login address may make in a window.
// The counts live in a shared store (Redis). When it fails, a local store counts instead, so an outage never switches
// the limit off.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { attemptAsync } from "@flash/typekit";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { RateLimitStore } from "./ports/rate-limit-store.js";

export type RateLimits = {
	windowSeconds: number;
	// Requests per shopper, per sale, in one window.
	perUser: number;
	// Requests per address, per sale, in one window.
	perIp: number;
	// Sign-ups, logins and refreshes per address in each window: guessing a password is a write request that costs more.
	authPerIp: number;
};

export type RateLimitVerdict =
	| { limited: false }
	| { limited: true; retryAfterSeconds: number };

export type RateLimiter = {
	// The auth routes: counted by address alone, with a limit of their own, apart from any sale.
	checkAuth: (request: { ip: string }) => Promise<RateLimitVerdict>;
	// The sale routes: counted by address and by shopper, within one sale. `user` is what the client sent, not yet checked.
	check: (request: {
		saleId: string;
		user: unknown;
		ip: string;
	}) => Promise<RateLimitVerdict>;
};

// One hit's count and the time left in its window.
type Counted = { count: number; resetInMs: number };

// A client told to retry is never told to retry at once: the wait is at least one second.
const MIN_RETRY_AFTER_SECONDS = 1;

export function createRateLimiter(
	shared: RateLimitStore,
	local: RateLimitStore,
	clock: Clock,
	limits: RateLimits,
): RateLimiter {
	// Counts one hit in the shared store, or in the local one when the shared store fails.
	async function hit(key: string, windowMs: number): Promise<Counted> {
		const counted = await attemptAsync(
			() => shared.hit(key, windowMs, clock()),
			Error,
		);
		return counted.isOk() ? counted.value : local.hit(key, windowMs, clock());
	}

	// The limits are read on every call, so a change applies to the next request.
	const windowMs = () => limits.windowSeconds * MS_PER_SECOND;
	const retryAfter = (resetInMs: number): RateLimitVerdict => ({
		limited: true,
		retryAfterSeconds: Math.max(
			Math.ceil(resetInMs / MS_PER_SECOND),
			MIN_RETRY_AFTER_SECONDS,
		),
	});

	return {
		async checkAuth(request) {
			const address = await hit(`address:auth:${request.ip}`, windowMs());
			return address.count > limits.authPerIp
				? retryAfter(address.resetInMs)
				: { limited: false };
		},

		async check(request) {
			const address = await hit(
				`address:${request.saleId}:${request.ip}`,
				windowMs(),
			);
			// A request with no usable user name still counts against its address. The route answers the bad name.
			const user = normalizeUser(request.user);
			const person = user
				? await hit(`user:${request.saleId}:${user}`, windowMs())
				: undefined;

			const over: Counted[] = [];
			if (address.count > limits.perIp) over.push(address);
			if (person && person.count > limits.perUser) over.push(person);
			if (over.length === 0) return { limited: false };

			return retryAfter(Math.max(...over.map((entry) => entry.resetInMs)));
		},
	};
}
