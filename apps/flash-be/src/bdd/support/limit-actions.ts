// The rate limits a queue scenario changes, the same at both layers (queue-world.ts and queue-integration.ts). Each layer
// passes the limits its rate limiter reads on every request, so a change applies to the next one.
import type { RateLimits } from "../../application/rate-limiter.js";

// Sets the per-user, per-address and login limits, each with the window they are counted in.
export function limitActions(limits: RateLimits) {
	return {
		async setUserLimit(requests: number, seconds: number) {
			limits.perUser = requests;
			limits.windowSeconds = seconds;
		},
		async setAddressLimit(requests: number, seconds: number) {
			limits.perIp = requests;
			limits.windowSeconds = seconds;
		},
		async setLoginLimit(requests: number, seconds: number) {
			limits.authPerIp = requests;
			limits.windowSeconds = seconds;
		},
	};
}
