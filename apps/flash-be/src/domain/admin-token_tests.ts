import { describe, expect, it } from "vitest";
import { bearerToken, tokenMatches } from "./admin-token.js";

describe("bearerToken", () => {
	it("reads the token of a Bearer header, whatever the case of the scheme", () => {
		expect(bearerToken("Bearer abc.def-1")).toBe("abc.def-1");
		expect(bearerToken("bearer abc")).toBe("abc");
	});

	it.each([
		["missing", undefined],
		["empty", ""],
		["another scheme", "Basic abc"],
		["without a token", "Bearer "],
		["with two words after the scheme", "Bearer a b"],
		["without the scheme", "abc"],
	])("finds nothing in a header that is %s", (_why, header) => {
		expect(bearerToken(header)).toBeUndefined();
	});
});

describe("tokenMatches", () => {
	it("accepts the same token and refuses any other, whatever its length", () => {
		expect(tokenMatches("operator-secret-0001", "operator-secret-0001")).toBe(
			true,
		);
		expect(tokenMatches("operator-secret-0001", "operator-secret-0002")).toBe(
			false,
		);
		expect(tokenMatches("operator-secret-0001", "x")).toBe(false);
		expect(tokenMatches("operator-secret-0001", "")).toBe(false);
	});
});
