import { MS_PER_SECOND } from "@flash/contract/vocabulary";
import { attemptAsync } from "@flash/typekit";
import { normalizeUser } from "../domain/user.js";
import type { Clock } from "./ports/clock.js";
import type { RateLimitStore } from "./ports/rate-limit-store.js";

export type RateLimits = {
	windowSeconds: number;
	perUser: number;
	perIp: number;
};

export type RateLimitVerdict =
	| { limited: false }
	| { limited: true; retryAfterSeconds: number };

export type RateLimiter = ReturnType<typeof createRateLimiter>;

// Limits write requests per user and per address, within one sale. `shared` is Redis; `local` takes over when
// Redis fails, so a Redis outage never turns the limit off. The limits are read on every call.
export function createRateLimiter(
	shared: RateLimitStore,
	local: RateLimitStore,
	clock: Clock,
	limits: RateLimits,
) {
	async function hit(key: string, windowMs: number) {
		const counted = await attemptAsync(
			() => shared.hit(key, windowMs, clock()),
			Error,
		);
		return counted.isOk() ? counted.value : local.hit(key, windowMs, clock());
	}

	return {
		async check(request: {
			saleId: string;
			user: unknown;
			ip: string;
		}): Promise<RateLimitVerdict> {
			const windowMs = limits.windowSeconds * MS_PER_SECOND;
			const address = await hit(
				`address:${request.saleId}:${request.ip}`,
				windowMs,
			);
			// A request with no usable user id still counts against its address. The route answers the bad id.
			const user = normalizeUser(request.user);
			const person = user
				? await hit(`user:${request.saleId}:${user}`, windowMs)
				: undefined;

			const over: Array<typeof address> = [];
			if (address.count > limits.perIp) over.push(address);
			if (person && person.count > limits.perUser) over.push(person);
			if (over.length === 0) return { limited: false };

			const resetInMs = Math.max(...over.map((entry) => entry.resetInMs));
			return {
				limited: true,
				retryAfterSeconds: Math.max(Math.ceil(resetInMs / MS_PER_SECOND), 1),
			};
		},
	};
}
