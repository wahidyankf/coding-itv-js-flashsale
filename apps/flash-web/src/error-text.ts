// Part of the sale page, shared by its hooks. The sentence the shopper reads for each error code. Account and sale codes have their own messages files; this file
// joins them and adds `rate_limited`, `network` and `backend_unavailable`, which either can get. Only sale-page.tsx imports it, so the account
// and sale folders never import each other.
import { authErrorText } from "./auth/messages";
import { saleErrorText } from "./sale/messages";

// The wait shown when the API gave none. One second is the shortest wait a rate limit can ask for.
const SHORTEST_WAIT_SECONDS = 1;
const NETWORK = "The sale could not be reached. Please try again.";
// For any code that no table names, so the shopper is never shown a blank line.
const FALLBACK = "Something went wrong. Please try again.";

// The sentence for an error code. `retryAfterSeconds` is used only for a rate limit.
export function errorText(
	errorCode: string,
	retryAfterSeconds?: number,
): string {
	if (errorCode === "rate_limited") {
		return `Too many requests. Try again in ${retryAfterSeconds ?? SHORTEST_WAIT_SECONDS} seconds.`;
	}
	// The web server answers `backend_unavailable` when flash-be cannot be reached. The shopper gets the same sentence as
	// for a lost connection, since in both cases the sale could not be reached.
	if (errorCode === "network" || errorCode === "backend_unavailable") {
		return NETWORK;
	}
	return authErrorText(errorCode) ?? saleErrorText(errorCode) ?? FALLBACK;
}
