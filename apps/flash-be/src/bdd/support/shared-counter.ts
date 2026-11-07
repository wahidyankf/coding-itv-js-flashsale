// A shared rate-limit counter for the unit layer (test support). Redis answers each count as a Result, so this wraps the
// in-memory counter the same way: a scenario or a test can then stand in for Redis without a real connection.
import { Ok } from "@flash/typekit";
import type {
	LocalRateLimitStore,
	RateLimitStore,
} from "../../application/ports/rate-limit-store.js";

// Puts a local rate-limit store behind the shared store port, so a unit scenario switches the shared store off the same way
// it switches Redis off. Each hit is answered as a success.
export function sharedCounter(local: LocalRateLimitStore): RateLimitStore {
	return {
		hit: async (key, windowMs, now) =>
			new Ok(await local.hit(key, windowMs, now)),
	};
}
