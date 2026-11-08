// Unit tests for the cookie helpers of the HTTP edge: reading one cookie, setting the login cookies, and cutting a user agent.
import { describe, expect, it } from "vitest";
import {
	cookieValue,
	cutUserAgent,
	REFRESH_COOKIE_PATH,
	setCookie,
} from "./cookies.js";

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
			setCookie("a", "b", {
				maxAgeSeconds: 60,
				path: "/api/v1/auth",
				secure: false,
			}),
		).toBe("a=b; Path=/api/v1/auth; Max-Age=60; HttpOnly; SameSite=Lax");
	});

	it("adds Secure on request", () => {
		expect(
			setCookie("a", "b", { maxAgeSeconds: 0, path: "/", secure: true }),
		).toBe("a=b; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
	});
});

// The refresh cookie is sent to the auth routes alone, so its path is the auth base path. The access cookie is `/`, set
// where the login is made (see routes/auth.ts).
describe("REFRESH_COOKIE_PATH", () => {
	it("is the auth base path of the API, /api/v1/auth", () => {
		expect(REFRESH_COOKIE_PATH).toBe("/api/v1/auth");
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
