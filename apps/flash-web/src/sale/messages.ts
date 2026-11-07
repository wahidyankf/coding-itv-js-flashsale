// The words of the sale: the status labels and notes, every sentence and button label of the sale page, and the error
// codes that are about a sale or a purchase. The account's words are in auth/messages.ts.
import type { SaleStatus } from "./types";

// The short name of each status, shown in the badge.
export const STATUS_LABEL: Record<SaleStatus, string> = {
	upcoming: "Not open yet",
	active: "On sale",
	sold_out: "Sold out",
	ended: "Ended",
};

// One plain sentence under the status: what the shopper can do now. The times of the window are shown next to it.
export const STATUS_NOTE: Record<SaleStatus, string> = {
	upcoming: "Buying opens when the sale starts.",
	active: "The sale is open. Log in, then press Buy Now.",
	sold_out: "All items have been bought.",
	ended: "This sale is over.",
};

// Every sentence and label of the sale page. Kept in one table, so the page only names what it shows.
export const TEXT = {
	status: "Status:",
	opens: "Opens",
	closes: "Closes",
	itemsLeft: "Items left:",
	buyNow: "Buy Now",
	checkStatus: "Check my status",
	confirmPurchase: "Confirm purchase",
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
	// Shown when the page has stopped following the sale, so the shopper knows the words on screen may be old.
	liveStopped: "Live updates stopped. Reload the page to see the latest sale.",
	waitingHint: "You can keep this page open. It updates by itself.",
	pending: "Loading the sale…",
	paymentFailed:
		"Payment failed. Your item is still held. Press Confirm purchase to try again.",
};

// The sentence for a shopper's place in the line.
export const waitingText = (place: number) =>
	`You are in the queue. Your place: ${place}.`;

// The sentence for an item that is held, with the seconds left to confirm it.
export const holdingText = (seconds: number) =>
	`An item is held for you. Confirm within ${seconds} seconds.`;

// The sentence for each sale or purchase error code. Undefined for any other code, which another file answers.
export function saleErrorText(errorCode: string): string | undefined {
	switch (errorCode) {
		case "sold_out":
			return "Sold out. No items are left.";
		case "sale_ended":
			return "The sale has ended.";
		case "sale_not_started":
			return "The sale has not started yet.";
		case "already_purchased":
			return "You already bought an item.";
		case "hold_expired":
			return TEXT.holdEnded;
		case "not_admitted":
			return "Please wait for your turn.";
		default:
			return undefined;
	}
}
