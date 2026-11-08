// Unit tests of the load accounts: the user and the address each shopper gets, the list a run signs up, the file the
// runner writes and k6 reads, and the tokens found in that file. The functions are pure, so no test needs Docker, k6 or
// the API.
import { describe, expect, it } from "vitest";
import {
	accountsFileName,
	accountsOf,
	hammerAccount,
	issuedTokens,
	latecomerAccount,
	shopperAccount,
	signedUpCounts,
	tokensByUser,
} from "./accounts.ts";
import { PROFILES } from "./profiles.ts";

describe("the accounts of a run", () => {
	it("gives shopper n the user shopper-n and an address of its own", () => {
		expect(shopperAccount(1)).toEqual({ user: "shopper-1", ip: "10.0.0.1" });
		expect(shopperAccount(300)).toEqual({
			user: "shopper-300",
			ip: "10.0.1.44",
		});
	});

	it("gives latecomers addresses apart from the shoppers' range", () => {
		expect(latecomerAccount(1)).toEqual({ user: "late-1", ip: "10.15.66.65" });
	});

	it("gives each hammer its own address of the documentation range", () => {
		expect(hammerAccount(3)).toEqual({ user: "hammer-3", ip: "192.0.2.3" });
	});

	it("lists the shoppers, then the latecomers, then the hammers", () => {
		const users = accountsOf({
			users: 2,
			latecomers: 1,
			hammerUsers: 1,
		}).map((account) => account.user);
		expect(users).toEqual(["shopper-1", "shopper-2", "late-1", "hammer-1"]);
	});

	it.each(Object.entries(PROFILES))(
		"gives the profile %s one user and one address per account",
		(_name, profile) => {
			const accounts = accountsOf(profile);
			const count = profile.users + profile.latecomers + profile.hammerUsers;
			expect(accounts).toHaveLength(count);
			expect(new Set(accounts.map((account) => account.user)).size).toBe(count);
			expect(new Set(accounts.map((account) => account.ip)).size).toBe(count);
		},
	);
});

describe("the accounts a profile signs up", () => {
	it("adds one spare shopper and one spare latecomer to the counts of the profile", () => {
		expect(signedUpCounts({ users: 2, latecomers: 1, hammerUsers: 1 })).toEqual(
			{ users: 3, latecomers: 2, hammerUsers: 1 },
		);
	});

	it.each(Object.entries(PROFILES))(
		"covers the arrival k6 may start at the end of the profile %s",
		(_name, profile) => {
			const counts = signedUpCounts(profile);
			expect(counts.users).toBe(profile.users + 1);
			expect(counts.latecomers).toBe(profile.latecomers + 1);
			expect(counts.hammerUsers).toBe(profile.hammerUsers);
		},
	);
});

describe("the tokens file", () => {
	it("names the file of a profile after the profile", () => {
		expect(accountsFileName("smoke")).toBe("smoke-accounts.json");
	});

	it("reads the token of each user from the file's object", () => {
		const tokens = tokensByUser('{"shopper-1":"tok-a","shopper-2":"tok-b"}');
		expect(tokens.get("shopper-2")).toBe("tok-b");
	});

	it("holds no tokens when the file is not JSON", () => {
		expect(tokensByUser("{not json").size).toBe(0);
	});

	it("holds no tokens when the file is not an object", () => {
		expect(tokensByUser('["tok-a"]').size).toBe(0);
		expect(tokensByUser("null").size).toBe(0);
	});

	it("drops an entry whose token is not a string", () => {
		const tokens = tokensByUser('{"shopper-1":"tok-a","shopper-2":7}');
		expect([...tokens.keys()]).toEqual(["shopper-1"]);
	});

	it("gives each shopper the token of their own account, in order", () => {
		const tokens = tokensByUser('{"shopper-1":"tok-a","shopper-3":"tok-c"}');
		expect(issuedTokens(tokens, shopperAccount, 3)).toEqual([
			"tok-a",
			"",
			"tok-c",
		]);
	});

	it("gives an empty token to a latecomer the file does not hold", () => {
		const tokens = tokensByUser("{}");
		expect(issuedTokens(tokens, latecomerAccount, 1)).toEqual([""]);
	});
});
