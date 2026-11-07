// The auth rules: a password's length, the hash of a token, the lifetimes of a login, and who is an operator.
import { describe, expect, it } from "vitest";
import {
	ACCESS_TTL_SECONDS,
	hashToken,
	isOperator,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	type Principal,
	REFRESH_TTL_SECONDS,
	usablePassword,
} from "./auth.js";

const person = (role: Principal["role"]): Principal => ({
	userId: "00000000-0000-4000-8000-000000000001",
	username: "ana",
	role,
});

describe("usablePassword", () => {
	it("accepts any text between the minimum and the maximum length", () => {
		expect(usablePassword("a long password")).toBe("a long password");
		expect(usablePassword("x".repeat(PASSWORD_MIN_LENGTH))).toBeDefined();
		expect(usablePassword("x".repeat(PASSWORD_MAX_LENGTH))).toBeDefined();
	});

	it("refuses a password outside the lengths, and anything that is not text", () => {
		expect(usablePassword("x".repeat(PASSWORD_MIN_LENGTH - 1))).toBeUndefined();
		expect(usablePassword("x".repeat(PASSWORD_MAX_LENGTH + 1))).toBeUndefined();
		expect(usablePassword(12345678)).toBeUndefined();
		expect(usablePassword(undefined)).toBeUndefined();
	});
});

describe("hashToken", () => {
	it("is the same SHA-256 hex every time, and is not the token", () => {
		const token = "a-token-value";
		expect(hashToken(token)).toBe(hashToken(token));
		expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(token)).not.toBe(token);
	});
});

describe("login rules", () => {
	it("last 15 minutes for access and 7 days for refresh", () => {
		expect(ACCESS_TTL_SECONDS).toBe(900);
		expect(REFRESH_TTL_SECONDS).toBe(604_800);
	});

	it("lets only an operator manage sales", () => {
		expect(isOperator(person("operator"))).toBe(true);
		expect(isOperator(person("shopper"))).toBe(false);
	});
});
