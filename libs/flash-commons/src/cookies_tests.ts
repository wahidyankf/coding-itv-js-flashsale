// Plain Vitest tests for the cookie jar, which follows a browser's rules (RFC 6265 for paths). The cookie names and paths below are the expected values.
import { describe, expect, it } from "vitest";
import {
	applySetCookies,
	type CookieJar,
	cookieHeader,
	cookieHeaderOf,
	parseSetCookie,
	pathMatches,
} from "./cookies.js";

const ACCESS = "access_token=a2; Path=/; Max-Age=900; HttpOnly; SameSite=Lax";
const REFRESH =
	"refresh_token=r2; Path=/auth; Max-Age=604800; HttpOnly; SameSite=Lax; Secure";

// The jar a login leaves: the access cookie for every path, the refresh cookie for /auth only.
const loggedIn = (): CookieJar => applySetCookies(new Map(), [ACCESS, REFRESH]);

describe("parseSetCookie", () => {
	it("reads the name, value, path and HttpOnly flag of a login cookie", () => {
		expect(parseSetCookie(ACCESS)).toEqual({
			name: "access_token",
			value: "a2",
			path: "/",
			httpOnly: true,
			expired: false,
		});
	});

	it("keeps the whole value, even when it holds an equals sign", () => {
		expect(parseSetCookie("token=ab=cd; Path=/").value).toBe("ab=cd");
	});

	it("reads a Max-Age of 0 as an expired cookie, with its empty value", () => {
		expect(parseSetCookie("refresh_token=; Max-Age=0; Path=/auth")).toEqual({
			name: "refresh_token",
			value: "",
			path: "/auth",
			httpOnly: false,
			expired: true,
		});
	});

	it("reads a negative Max-Age as expired too", () => {
		expect(parseSetCookie("a=b; Max-Age=-1").expired).toBe(true);
	});

	it("does not expire a cookie whose Max-Age is not a whole number", () => {
		expect(parseSetCookie("a=b; Max-Age=soon").expired).toBe(false);
		expect(parseSetCookie("a=b; Max-Age=").expired).toBe(false);
	});

	it("reads the attribute names without regard to case", () => {
		expect(parseSetCookie("a=b; path=/auth; max-age=0; httponly")).toEqual({
			name: "a",
			value: "b",
			path: "/auth",
			httpOnly: true,
			expired: true,
		});
	});

	it("reads a line with no equals sign as a cookie with no name", () => {
		expect(parseSetCookie("orphan")).toMatchObject({
			name: "",
			value: "orphan",
		});
	});

	it("reads no path when the cookie names none, and none when it is not a path", () => {
		expect(parseSetCookie("a=b").path).toBeUndefined();
		expect(parseSetCookie("a=b; Path=auth").path).toBeUndefined();
	});
});

describe("pathMatches", () => {
	it("matches every path for the cookie path /", () => {
		expect(pathMatches("/", "/")).toBe(true);
		expect(pathMatches("/", "/sales/x")).toBe(true);
		expect(pathMatches("/", "/auth")).toBe(true);
	});

	it("matches the same path, and the paths under it, for /auth", () => {
		expect(pathMatches("/auth", "/auth")).toBe(true);
		expect(pathMatches("/auth", "/auth/refresh")).toBe(true);
	});

	it("does not match a path that only starts with the cookie path", () => {
		expect(pathMatches("/auth", "/authx")).toBe(false);
		expect(pathMatches("/auth", "/auth-x")).toBe(false);
	});

	it("does not match a shorter path, or a different one", () => {
		expect(pathMatches("/auth", "/")).toBe(false);
		expect(pathMatches("/auth", "/aut")).toBe(false);
		expect(pathMatches("/auth", "/sales")).toBe(false);
	});

	it("matches the paths under a cookie path that ends with a slash, but not that path without it", () => {
		expect(pathMatches("/auth/", "/auth/x")).toBe(true);
		expect(pathMatches("/auth/", "/auth")).toBe(false);
	});
});

describe("applySetCookies", () => {
	it("keeps each cookie with its path, and with the path / when it names none", () => {
		const jar = applySetCookies(new Map(), ["a=b", ACCESS]);
		expect(jar.get("a")).toEqual({ value: "b", path: "/" });
		expect(jar.get("access_token")).toEqual({ value: "a2", path: "/" });
	});

	it("takes a later Set-Cookie of the same name", () => {
		const jar = applySetCookies(new Map(), ["a=1; Path=/x", "a=2; Path=/y"]);
		expect(jar.get("a")).toEqual({ value: "2", path: "/y" });
	});

	it("forgets a cookie that the reply expires, and keeps the others", () => {
		const jar = applySetCookies(loggedIn(), [
			"refresh_token=; Max-Age=0; Path=/auth",
		]);
		expect(jar.has("refresh_token")).toBe(false);
		expect(jar.get("access_token")?.value).toBe("a2");
	});

	it("ignores a line with no name, as a browser does", () => {
		expect(applySetCookies(new Map(), ["orphan", "=x; Path=/"]).size).toBe(0);
	});

	it("does not change the jar it is given", () => {
		const before = loggedIn();
		const after = applySetCookies(before, ["a=b"]);
		expect(after).not.toBe(before);
		expect(before.has("a")).toBe(false);
		expect(after.has("a")).toBe(true);
	});
});

describe("cookieHeader", () => {
	it("sends the cookies whose path matches the request, in the order they were kept", () => {
		expect(cookieHeader(loggedIn(), "/auth/me")).toBe(
			"access_token=a2; refresh_token=r2",
		);
		expect(cookieHeader(loggedIn(), "/sales/x")).toBe("access_token=a2");
	});

	it("does not send the refresh cookie to a path that only starts with /auth", () => {
		expect(cookieHeader(loggedIn(), "/authx")).toBe("access_token=a2");
	});

	it("sends nothing, and says so with undefined, when no cookie matches", () => {
		const onlyRefresh = applySetCookies(new Map(), [REFRESH]);
		expect(cookieHeader(onlyRefresh, "/sales")).toBeUndefined();
		expect(cookieHeader(new Map(), "/")).toBeUndefined();
	});
});

describe("cookieHeaderOf", () => {
	it("names every cookie the jar holds, whatever its path", () => {
		expect(cookieHeaderOf(loggedIn())).toBe(
			"access_token=a2; refresh_token=r2",
		);
	});

	it("is empty for a jar with no cookies", () => {
		expect(cookieHeaderOf(new Map())).toBe("");
	});
});
