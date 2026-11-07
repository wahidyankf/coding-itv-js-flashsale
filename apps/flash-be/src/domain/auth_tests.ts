import { describe, expect, it } from "vitest";
import {
	ACCESS_TTL_SECONDS,
	cookieValue,
	cutUserAgent,
	hashToken,
	newToken,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	REFRESH_TTL_SECONDS,
	setCookie,
	usablePassword,
} from "./auth.js";

describe("usablePassword", () => {
	it("accepts text of a usable length, spaces and symbols included", () => {
		expect(usablePassword("a long password")).toBe("a long password");
		expect(usablePassword("x".repeat(PASSWORD_MIN_LENGTH))).toBeDefined();
		expect(usablePassword("x".repeat(PASSWORD_MAX_LENGTH))).toBeDefined();
	});

	it("refuses text that is too short or too long, and what is not text", () => {
		expect(usablePassword("x".repeat(PASSWORD_MIN_LENGTH - 1))).toBeUndefined();
		expect(usablePassword("x".repeat(PASSWORD_MAX_LENGTH + 1))).toBeUndefined();
		expect(usablePassword(12345678)).toBeUndefined();
		expect(usablePassword(undefined)).toBeUndefined();
	});
});

describe("tokens", () => {
	it("are random, long enough to resist guessing, and safe in a cookie", () => {
		const first = newToken();
		expect(first).not.toBe(newToken());
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("are stored as the same SHA-256 hex every time, which is not the token", () => {
		const token = newToken();
		expect(hashToken(token)).toBe(hashToken(token));
		expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(token)).not.toBe(token);
	});

	it("last 15 minutes for access and 7 days for refresh", () => {
		expect(ACCESS_TTL_SECONDS).toBe(900);
		expect(REFRESH_TTL_SECONDS).toBe(604_800);
	});
});

describe("cookieValue", () => {
	it("finds one cookie among several, with or without spaces", () => {
		const header = "a=1; access_token=abc;refresh_token=def";
		expect(cookieValue(header, "access_token")).toBe("abc");
		expect(cookieValue(header, "refresh_token")).toBe("def");
		expect(cookieValue(header, "a")).toBe("1");
	});

	it("finds nothing for a missing header, a missing cookie, an empty value or a piece without =", () => {
		expect(cookieValue(undefined, "a")).toBeUndefined();
		expect(cookieValue("b=1", "a")).toBeUndefined();
		expect(cookieValue("a=", "a")).toBeUndefined();
		expect(cookieValue("junk; a=1", "a")).toBe("1");
		expect(cookieValue("junk", "a")).toBeUndefined();
	});

	it("does not mistake a longer name for the name", () => {
		expect(cookieValue("xaccess_token=1", "access_token")).toBeUndefined();
	});
});

describe("setCookie", () => {
	it("is HttpOnly and SameSite=Lax, with its path and its age", () => {
		expect(
			setCookie("a", "b", { maxAgeSeconds: 60, path: "/auth", secure: false }),
		).toBe("a=b; Path=/auth; Max-Age=60; HttpOnly; SameSite=Lax");
	});

	it("adds Secure on request", () => {
		expect(
			setCookie("a", "b", { maxAgeSeconds: 0, path: "/", secure: true }),
		).toBe("a=b; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
	});
});

describe("cutUserAgent", () => {
	it("keeps the start of a long text", () => {
		expect(cutUserAgent("a".repeat(500))).toHaveLength(200);
	});

	it("keeps a short text whole, and nothing when the client sent none", () => {
		expect(cutUserAgent("Firefox")).toBe("Firefox");
		expect(cutUserAgent(undefined)).toBeUndefined();
		expect(cutUserAgent(["a", "b"])).toBeUndefined();
	});
});
