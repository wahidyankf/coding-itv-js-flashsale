// Unit tests for the rules of the buying card: the hold's countdown, the sentence under the buttons, the purchase's id line,
// and which buttons work.
import { describe, expect, it } from "vitest";
import { TEXT, waitingText } from "./messages";
import {
	holdingPhase,
	type Phase,
	phaseText,
	purchaseIdText,
	secondsLeft,
	shopperFlags,
} from "./shopper-state";

const EXPIRES = "2026-06-01T12:02:00Z";
const EXPIRES_MS = Date.parse(EXPIRES);
const PURCHASE_ID = "5d1f0c8e-3b7a-4c2e-9f61-0a8d2e4b7c10";
const HOLD: Phase = {
	kind: "holding",
	reservationId: "r1",
	expiresAt: EXPIRES_MS,
};

describe("holdingPhase", () => {
	it("turns the time the server gave into epoch milliseconds", () => {
		expect(holdingPhase("r1", EXPIRES)).toEqual(HOLD);
	});
});

describe("secondsLeft", () => {
	it("counts the seconds of a hold, rounding a part second up", () => {
		expect(secondsLeft(HOLD, EXPIRES_MS - 1500)).toBe(2);
	});

	it("never goes below zero once the hold has run out", () => {
		expect(secondsLeft(HOLD, EXPIRES_MS + 5000)).toBe(0);
	});

	it("is zero when nothing is held", () => {
		expect(secondsLeft({ kind: "idle" }, EXPIRES_MS)).toBe(0);
	});
});

describe("phaseText", () => {
	it("says nothing while the shopper is idle", () => {
		expect(phaseText({ kind: "idle" }, 0)).toBe("");
	});

	it("shows the request that is in flight", () => {
		expect(
			phaseText({ kind: "busy", action: "check", text: TEXT.checking }, 0),
		).toBe(TEXT.checking);
	});

	it("tells a waiting shopper the place in line", () => {
		expect(phaseText({ kind: "waiting", place: 4 }, 0)).toBe(waitingText(4));
	});

	it("counts down the hold in seconds", () => {
		expect(phaseText(HOLD, 30)).toBe(
			"An item is held for you. Confirm within 30 seconds.",
		);
	});

	it("shows the payment notice in place of the countdown", () => {
		const held: Phase = { ...HOLD, notice: TEXT.paymentFailed };
		expect(phaseText(held, 30)).toBe(TEXT.paymentFailed);
	});

	it("says the purchase is confirmed", () => {
		expect(phaseText({ kind: "purchased", purchaseId: PURCHASE_ID }, 0)).toBe(
			TEXT.purchased,
		);
	});

	it("shows the result the shopper moves on from", () => {
		expect(phaseText({ kind: "result", text: TEXT.nothing }, 0)).toBe(
			TEXT.nothing,
		);
	});
});

describe("purchaseIdText", () => {
	it("shows the id of a confirmed purchase under the Purchase ID label", () => {
		expect(purchaseIdText({ kind: "purchased", purchaseId: PURCHASE_ID })).toBe(
			`Purchase ID: ${PURCHASE_ID}`,
		);
	});

	it("shows no purchase id while an item is held or nothing is bought", () => {
		expect(purchaseIdText(HOLD)).toBeUndefined();
		expect(purchaseIdText({ kind: "idle" })).toBeUndefined();
	});
});

describe("shopperFlags", () => {
	it("lets an idle shopper buy from an active sale", () => {
		expect(shopperFlags({ kind: "idle" }, "active")).toEqual({
			busy: false,
			buying: false,
			canBuy: true,
			action: undefined,
		});
	});

	it("keeps the spinner on Buy Now while the queue is joined", () => {
		expect(
			shopperFlags(
				{ kind: "busy", action: "buy", text: TEXT.joining },
				"active",
			),
		).toEqual({
			busy: true,
			buying: true,
			canBuy: false,
			action: "buy",
		});
	});

	it("marks a status check as busy without the buying spinner", () => {
		expect(
			shopperFlags(
				{ kind: "busy", action: "check", text: TEXT.checking },
				"active",
			),
		).toEqual({
			busy: true,
			buying: false,
			canBuy: false,
			action: "check",
		});
	});

	it("keeps a shopper in the queue buying, with no button pressed", () => {
		expect(shopperFlags({ kind: "waiting", place: 2 }, "active")).toEqual({
			busy: true,
			buying: true,
			canBuy: false,
			action: undefined,
		});
	});

	it("does not offer a second buy while an item is held", () => {
		expect(shopperFlags(HOLD, "active")).toEqual({
			busy: false,
			buying: false,
			canBuy: false,
			action: undefined,
		});
	});

	it.each(["upcoming", "sold_out", "ended"] as const)(
		"does not let a shopper buy from a %s sale",
		(status) => {
			expect(shopperFlags({ kind: "idle" }, status).canBuy).toBe(false);
		},
	);
});
