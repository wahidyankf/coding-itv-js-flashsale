// Unit tests for the sale's words: the status tables, the two sentences with numbers, and the sale's error codes.
import { describe, expect, it } from "vitest";
import {
	holdingText,
	STATUS_LABEL,
	STATUS_NOTE,
	saleErrorText,
	TEXT,
	waitingText,
} from "./messages";

describe("sale error codes", () => {
	it.each<[string, string]>([
		["sold_out", "Sold out. No items are left."],
		["sale_ended", "The sale has ended."],
		["sale_not_started", "The sale has not started yet."],
		["already_purchased", "You already bought an item."],
		["hold_expired", TEXT.holdEnded],
		["not_admitted", "Please wait for your turn."],
	])("says what %s means", (code, text) => {
		expect(saleErrorText(code)).toBe(text);
	});

	it("names no sentence for a code that is not the sale's", () => {
		expect(saleErrorText("invalid_user")).toBeUndefined();
	});
});

describe("sentences", () => {
	it("names the place and the seconds", () => {
		expect(waitingText(4)).toContain("Your place: 4.");
		expect(holdingText(30)).toContain("within 30 seconds");
	});

	it("says something plain for every status", () => {
		expect(Object.keys(STATUS_NOTE).sort()).toEqual(
			Object.keys(STATUS_LABEL).sort(),
		);
		for (const note of Object.values(STATUS_NOTE))
			expect(note.length).toBeGreaterThan(0);
	});

	it("labels every status", () => {
		expect(Object.keys(STATUS_LABEL).sort()).toEqual([
			"active",
			"ended",
			"sold_out",
			"upcoming",
		]);
	});
});
