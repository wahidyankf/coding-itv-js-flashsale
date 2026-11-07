// Unit tests for the sentence the shopper reads for an error code: the account's, the sale's, and the two both can get.
import { describe, expect, it } from "vitest";
import { errorText } from "./error-text";

describe("errorText", () => {
	it.each<[string, string]>([
		["invalid_user", "Use 1 to 64 letters, digits or . _ @ + - characters."],
		["invalid_password", "Use 8 to 128 characters for the password."],
		["invalid_credentials", "Wrong name or password."],
		["username_taken", "That name is taken. Choose another one."],
		["not_authenticated", "Your login has ended. Please log in again."],
		["invalid_refresh_token", "Your login has ended. Please log in again."],
	])("says what the account's %s means", (code, text) => {
		expect(errorText(code)).toBe(text);
	});

	it.each<[string, string]>([
		["sold_out", "Sold out. No items are left."],
		["sale_ended", "The sale has ended."],
		["sale_not_started", "The sale has not started yet."],
		["already_purchased", "You already bought an item."],
		["hold_expired", "Your hold has ended. Press Buy Now to try again."],
		["not_admitted", "Please wait for your turn."],
	])("says what the sale's %s means", (code, text) => {
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

	it("says the sale could not be reached when the network fails", () => {
		expect(errorText("network")).toBe(
			"The sale could not be reached. Please try again.",
		);
	});

	it.each(["unexpected", "internal"])(
		"says something went wrong for %s",
		(code) => {
			expect(errorText(code)).toBe("Something went wrong. Please try again.");
		},
	);
});
