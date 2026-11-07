// The rate limit use case: how many write requests one shopper, one address, or one login address may make in a window.
// The counts live in a shared store (Redis). When it fails, a local store counts instead, so an outage never switches
// the limit off. Application layer.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { attemptAsync } from "@flash/typekit";
import type { Username } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type {
	LocalRateLimitStore,
	RateLimitStore,
} from "./ports/rate-limit-store.js";

// The limits from configuration, with one window for all of them. A test copies and changes them in place to reach a limit.
export type RateLimits = {
	windowSeconds: number;
	// Requests per shopper, per sale, in one window.
	perUser: number;
	// Requests per address, per sale, in one window.
	perIp: number;
	// Sign-ups, logins and refreshes per address in each window: guessing a password is a write request that costs more.
	authPerIp: number;
};

// The answer to one limit check: allowed, or refused with the seconds to wait.
export type RateLimitVerdict =
	| { limited: false }
	| { limited: true; retryAfterSeconds: number };

// The check the HTTP adapter runs before a write. The auth routes and the sale routes are counted apart.
export type RateLimiter = {
	// The auth routes: counted by address alone, with a limit of their own, apart from any sale.
	checkAuth: (request: { ip: string }) => Promise<RateLimitVerdict>;
	// The sale routes: counted by address and by shopper, within one sale. `user` is the login of the request, and is
	// undefined when there is none; the request still counts against its address.
	check: (request: {
		saleId: string;
		user: Username | undefined;
		ip: string;
	}) => Promise<RateLimitVerdict>;
};

// One hit's count and the time left in its window.
type Counted = { count: number; resetInMs: number };

// A client told to retry is never told to retry at once: the wait is at least one second.
const MIN_RETRY_AFTER_SECONDS = 1;

// Wires the limiter over a shared store and a local one. The clock comes in, so a window can be moved in tests.
export function createRateLimiter(
	shared: RateLimitStore,
	local: LocalRateLimitStore,
	clock: Clock,
	limits: RateLimits,
): RateLimiter {
	// Counts one hit in the shared store, or in the local one when the shared store fails or cannot be read.
	async function hit(key: string, windowMs: number): Promise<Counted> {
		const counted = await attemptAsync(
			() => shared.hit(key, windowMs, clock()),
			Error,
		);
		if (counted.isOk() && counted.value.isOk()) return counted.value.value;
		return local.hit(key, windowMs, clock());
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
			// A request with no login still counts against its address; the guard refuses it after this check.
			const person =
				request.user === undefined
					? undefined
					: await hit(`user:${request.saleId}:${request.user}`, windowMs());

			const over: Counted[] = [];
			if (address.count > limits.perIp) over.push(address);
			if (person && person.count > limits.perUser) over.push(person);
			if (over.length === 0) return { limited: false };

			return retryAfter(Math.max(...over.map((entry) => entry.resetInMs)));
		},
	};
}
