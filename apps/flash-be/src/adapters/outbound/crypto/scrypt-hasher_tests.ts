import { describe, expect, it } from "vitest";
import { createScryptHasher } from "./scrypt-hasher.js";

const hasher = createScryptHasher();

describe("the scrypt hasher", () => {
	it("stores a salted hash that is not the password", async () => {
		const stored = await hasher.hash("a long password");
		expect(stored).toMatch(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
		expect(stored).not.toContain("a long password");
	});

	it("gives two different hashes for one password, because the salt differs", async () => {
		expect(await hasher.hash("a long password")).not.toBe(
			await hasher.hash("a long password"),
		);
	});

	it("accepts the password it hashed and no other", async () => {
		const stored = await hasher.hash("a long password");
		expect(await hasher.verify("a long password", stored)).toBe(true);
		expect(await hasher.verify("a long passwore", stored)).toBe(false);
		expect(await hasher.verify("", stored)).toBe(false);
	});

	it("refuses a stored value that is not of its scheme", async () => {
		expect(
			await hasher.verify("a long password", "plain$a long password"),
		).toBe(false);
		expect(await hasher.verify("a long password", "scrypt$only-salt")).toBe(
			false,
		);
		expect(await hasher.verify("a long password", "")).toBe(false);
	});
});
