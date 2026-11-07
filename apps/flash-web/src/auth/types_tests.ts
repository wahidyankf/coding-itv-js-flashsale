// Unit tests for the account's decoder: the account as flash-be sends it, and the bad ones (a role that is not one of the
// two, a name that is empty, a missing field).
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { decodeAccount } from "./types";

describe("decodeAccount", () => {
	it.each([
		{ username: "ana", role: "shopper" },
		{ username: "ops", role: "operator" },
	])("reads the account %j", (account) => {
		expect(decodeAccount(account)).toEqual(new Ok(account));
	});

	it("refuses a role that is not one of the two", () => {
		expect(decodeAccount({ username: "ana", role: "admin" })).toEqual(
			new Err({ path: "role", expected: 'one of "shopper", "operator"' }),
		);
	});

	it("refuses an empty user name", () => {
		expect(decodeAccount({ username: "", role: "shopper" })).toEqual(
			new Err({ path: "username", expected: "a non-empty text" }),
		);
	});

	it("refuses an account with no role", () => {
		expect(decodeAccount({ username: "ana" })).toEqual(
			new Err({ path: "role", expected: 'one of "shopper", "operator"' }),
		);
	});
});
