// Browser only, part of the sale feature. The rules of the buying card as plain functions: where the shopper is, how long a hold has left, which sentence the
// page shows, and which buttons work. No React and no I/O, so each rule is tested by calling it. `use-shopper.ts` keeps
// the requests and the effects, and calls these.
import { MS_PER_SECOND } from "@flash/flash-commons";
import { holdingText, TEXT, waitingText } from "./messages";
import type { SaleStatus } from "./types";

// What the shopper asked for, so the page can show the spinner on the button that was pressed.
export type Action = "buy" | "check" | "confirm";

// Where the shopper is. `busy` is a request in flight, `waiting` is a place in the queue, and `holding` is an item kept
// for the shopper. `result` is a sentence the shopper reads and then moves on from.
export type Phase =
	| { kind: "idle" }
	| { kind: "busy"; action: Action; text: string }
	| { kind: "waiting"; place: number }
	| {
			kind: "holding";
			reservationId: string;
			// Epoch milliseconds, so the countdown can be worked out from the clock.
			expiresAt: number;
			// Set when a payment failed: the item is still held, and the reason stays on screen with it.
			notice?: string;
	  }
	| { kind: "purchased"; purchaseId: string }
	| { kind: "result"; text: string };

// The phase of a hold the server just gave. The server sends the time as text; the page counts in milliseconds.
export function holdingPhase(reservationId: string, expiresAt: string): Phase {
	return { kind: "holding", reservationId, expiresAt: Date.parse(expiresAt) };
}

// The phase of a confirmed purchase. The id is kept, so the page can show it under the sentence.
export function purchasedPhase(purchaseId: string): Phase {
	return { kind: "purchased", purchaseId };
}

// Whole seconds left on a hold, rounded up so the page never shows 0 while time is left. Zero when nothing is held.
export function secondsLeft(phase: Phase, clock: number): number {
	if (phase.kind !== "holding") return 0;
	return Math.max(0, Math.ceil((phase.expiresAt - clock) / MS_PER_SECOND));
}

// The sentence under the buttons. The countdown is passed in, so the sentence follows the clock.
export function phaseText(phase: Phase, seconds: number): string {
	switch (phase.kind) {
		case "idle":
			return "";
		case "busy":
			return phase.text;
		case "waiting":
			return waitingText(phase.place);
		case "holding":
			return phase.notice ?? holdingText(seconds);
		case "purchased":
			return TEXT.purchased;
		case "result":
			return phase.text;
	}
}

// The line that carries the id of the shopper's purchase under the sentence. Only a purchase has an id, so every other phase
// has no line.
export function purchaseIdText(phase: Phase): string | undefined {
	return phase.kind === "purchased"
		? `${TEXT.purchaseId}: ${phase.purchaseId}`
		: undefined;
}

// What the buttons show and allow. `action` is the button that was pressed, if one is still working.
export type ShopperFlags = {
	busy: boolean;
	buying: boolean;
	canBuy: boolean;
	action: Action | undefined;
};

// Worked out once per render, so the buttons, the forms and the status line can never disagree.
export function shopperFlags(
	phase: Phase,
	saleStatus: SaleStatus,
): ShopperFlags {
	const busy = phase.kind === "busy" || phase.kind === "waiting";
	const action = phase.kind === "busy" ? phase.action : undefined;
	return {
		busy,
		// A shopper in the queue is still buying, so the spinner stays on Buy Now even with no button pressed.
		buying: action === "buy" || phase.kind === "waiting",
		// One item per shopper: no second buy while an item is already held.
		canBuy: saleStatus === "active" && !busy && phase.kind !== "holding",
		action,
	};
}
