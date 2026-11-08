// Part of the sale page, shared by its hooks. The sentence the shopper reads for each error code. Account and sale codes have their own messages files; this file
// joins them and adds `rate_limited` and `network`, which either can get. Only sale-page.tsx imports it, so the account
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
	if (errorCode === "network") return NETWORK;
	return authErrorText(errorCode) ?? saleErrorText(errorCode) ?? FALLBACK;
}
