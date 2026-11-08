// Unit tests of the sign-up helpers of the load runner: the access token read from a reply's cookies, and the split of the
// accounts into the groups that sign up together. No test signs up a real account; a run does that against the stack.
import { describe, expect, it } from "vitest";
import { accessTokenOf, groupsOf } from "./accounts.ts";

describe("accessTokenOf", () => {
	it("reads the access cookie among the cookies a reply sets", () => {
		expect(
			accessTokenOf([
				"refresh_token=r-1; Path=/auth; Max-Age=604800; HttpOnly",
				"access_token=a-1; Path=/; Max-Age=900; HttpOnly",
			]),
		).toBe("a-1");
	});

	it("finds no token when the reply sets no access cookie", () => {
		expect(accessTokenOf(["refresh_token=r-1; Path=/auth"])).toBeUndefined();
	});

	it("ignores an access cookie the reply clears", () => {
		expect(accessTokenOf(["access_token=; Path=/; Max-Age=0"])).toBeUndefined();
	});

	it("finds no token when the access cookie is empty", () => {
		expect(
			accessTokenOf(["access_token=; Path=/; Max-Age=900; HttpOnly"]),
		).toBeUndefined();
	});
});

describe("groupsOf", () => {
	it("splits the accounts into groups of at most the size given", () => {
		expect(groupsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it("gives no group when there are no accounts", () => {
		expect(groupsOf([], 2)).toEqual([]);
	});
});
