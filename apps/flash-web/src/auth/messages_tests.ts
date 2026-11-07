// Unit tests for the account's words and rules: the user name check and the sentences for the account's error codes.
import { describe, expect, it } from "vitest";
import { authErrorText, cleanUser } from "./messages";

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

describe("authErrorText", () => {
	it("says what each account code means", () => {
		expect(authErrorText("invalid_password")).toBe(
			"Use 8 to 128 characters for the password.",
		);
		expect(authErrorText("invalid_credentials")).toBe(
			"Wrong name or password.",
		);
		expect(authErrorText("username_taken")).toBe(
			"That name is taken. Choose another one.",
		);
	});

	it("names no sentence for a code that is not the account's", () => {
		expect(authErrorText("sold_out")).toBeUndefined();
	});
});
