import type { ApiFailure, SaleStatus } from "./types";

export const STATUS_LABEL: Record<SaleStatus, string> = {
	upcoming: "Not open yet",
	active: "On sale",
	sold_out: "Sold out",
	ended: "Ended",
};

// One plain sentence under the status: what the shopper can do now. The times of the window are shown next to it.
export const STATUS_NOTE: Record<SaleStatus, string> = {
	upcoming: "Buying opens when the sale starts.",
	active: "The sale is open. Enter your name and press Buy Now.",
	sold_out: "All items have been bought.",
	ended: "This sale is over.",
};

// The same rule the API uses for a user id (trimmed, lowercased), so a bad name is refused before anything is sent.
// A copy of `normalizeUser` in flash-be; `same_as_be_tests.ts` fails when the two differ.
const USER_ID = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

export function cleanUser(raw: string): string | undefined {
	const user = raw.trim().toLowerCase();
	return USER_ID.test(user) ? user : undefined;
}

export const TEXT = {
	invalidUser: "Use 1 to 64 letters, digits or . _ @ + - characters.",
	joining: "Joining the queue…",
	reserving: "You are through. Holding an item for you…",
	paying: "Paying…",
	checking: "Checking…",
	purchased: "You got it! Your purchase is confirmed.",
	holdEnded: "Your hold has ended. Press Buy Now to try again.",
	nothing: "You have no purchase and no hold.",
	placeLost: "Your place was lost. Press Buy Now to join again.",
	noSale: "No sale is open right now.",
	noSaleHint: "Check back later, and reload this page to see a new sale.",
	loadFailed: "The sale could not be loaded.",
	loadFailedHint: "Reload the page to try again.",
	waitingHint: "You can keep this page open. It updates by itself.",
	pending: "Loading the sale…",
	paymentFailed:
		"Payment failed. Your item is still held. Press Confirm purchase to try again.",
};

export const waitingText = (place: number) =>
	`You are in the queue. Your place: ${place}.`;

export const holdingText = (seconds: number) =>
	`An item is held for you. Confirm within ${seconds} seconds.`;

// One sentence for each error code the API can answer with.
export function errorText(
	errorCode: ApiFailure["errorCode"],
	retryAfterSeconds?: number,
): string {
	switch (errorCode) {
		case "sold_out":
			return "Sold out. No items are left.";
		case "sale_ended":
			return "The sale has ended.";
		case "sale_not_started":
			return "The sale has not started yet.";
		case "already_purchased":
			return "You already bought an item.";
		case "invalid_user":
			return TEXT.invalidUser;
		case "rate_limited":
			return `Too many requests. Try again in ${retryAfterSeconds ?? 1} seconds.`;
		case "hold_expired":
			return TEXT.holdEnded;
		case "not_admitted":
			return "Please wait for your turn.";
		case "network":
			return "The sale could not be reached. Please try again.";
		default:
			return "Something went wrong. Please try again.";
	}
}
