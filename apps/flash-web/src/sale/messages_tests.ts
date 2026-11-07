import { describe, expect, it } from "vitest";
import {
	cleanUser,
	errorText,
	holdingText,
	STATUS_LABEL,
	STATUS_NOTE,
	TEXT,
	waitingText,
} from "./messages";
import type { ApiFailure } from "./types";

describe("cleanUser", () => {
	it("trims and lowercases a good name", () => {
		expect(cleanUser("  Ana.B@Example.com ")).toEqual("ana.b@example.com");
	});

	it.each(["", "   ", "has space", "-start", "x".repeat(65), "a/b"])(
		"refuses %j",
		(raw) => {
			expect(cleanUser(raw)).toBeUndefined();
		},
	);

	it("accepts the longest name", () => {
		expect(cleanUser("a".repeat(64))).toBe("a".repeat(64));
	});
});

describe("errorText", () => {
	it.each<[ApiFailure["errorCode"], string]>([
		["sold_out", "Sold out. No items are left."],
		["sale_ended", "The sale has ended."],
		["sale_not_started", "The sale has not started yet."],
		["already_purchased", "You already bought an item."],
		["invalid_user", TEXT.invalidUser],
		["invalid_password", "Use 8 to 128 characters for the password."],
		["invalid_credentials", "Wrong name or password."],
		["username_taken", "That name is taken. Choose another one."],
		["not_authenticated", "Your login has ended. Please log in again."],
		["invalid_refresh_token", "Your login has ended. Please log in again."],
		["hold_expired", TEXT.holdEnded],
		["not_admitted", "Please wait for your turn."],
		["network", "The sale could not be reached. Please try again."],
		["unexpected", "Something went wrong. Please try again."],
		["internal", "Something went wrong. Please try again."],
	])("says what %s means", (code, text) => {
		expect(errorText(code)).toBe(text);
	});

	it("tells a limited shopper how long to wait", () => {
		expect(errorText("rate_limited", 12)).toBe(
			"Too many requests. Try again in 12 seconds.",
		);
	});

	it("waits one second when the API gave no time", () => {
		expect(errorText("rate_limited")).toBe(
			"Too many requests. Try again in 1 seconds.",
		);
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
