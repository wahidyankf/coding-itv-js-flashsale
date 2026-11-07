import { createHash, randomBytes } from "node:crypto";

export type Role = "shopper" | "operator";

// Who is making a request: the user row, the name the shopper typed, and what they may do.
export type Principal = { userId: string; username: string; role: Role };

// The two cookies of a login. The access token is short and goes with every request. The refresh token lives longer, is
// sent only to the auth routes, and is replaced each time it is used.
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const REFRESH_COOKIE_PATH = "/auth";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86_400;
// Short, because it goes with every request and a copy of it is worth little for long.
const ACCESS_TTL_MINUTES = 15;
// A week without a visit ends the login; every use of the refresh token starts a new week.
const REFRESH_TTL_DAYS = 7;

export const ACCESS_TTL_SECONDS = ACCESS_TTL_MINUTES * SECONDS_PER_MINUTE;
export const REFRESH_TTL_SECONDS = REFRESH_TTL_DAYS * SECONDS_PER_DAY;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const TOKEN_BYTES = 32;
// A user agent is text from the client, so only this much of it is kept for the record of a login.
const MAX_USER_AGENT_LENGTH = 200;

export function cutUserAgent(raw: unknown): string | undefined {
	return typeof raw === "string"
		? raw.slice(0, MAX_USER_AGENT_LENGTH)
		: undefined;
}

// A password is any text of a usable length. The rules stay short on purpose; a long phrase beats a pattern.
export function usablePassword(raw: unknown): string | undefined {
	return typeof raw === "string" &&
		raw.length >= PASSWORD_MIN_LENGTH &&
		raw.length <= PASSWORD_MAX_LENGTH
		? raw
		: undefined;
}

// A token is 32 random bytes. The server keeps only its SHA-256, so the database never holds a usable token.
export function newToken(): string {
	return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

// The value of one cookie in a `Cookie` header, or nothing.
export function cookieValue(
	header: string | undefined,
	name: string,
): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		if (part.slice(0, separator).trim() === name) {
			const value = part.slice(separator + 1).trim();
			return value === "" ? undefined : value;
		}
	}
	return undefined;
}

export type CookieOptions = {
	maxAgeSeconds: number;
	path: string;
	secure: boolean;
};

// A `Set-Cookie` value. The script of a page cannot read it (HttpOnly), and another site cannot make the browser send
// it with a POST (SameSite=Lax).
export function setCookie(
	name: string,
	value: string,
	options: CookieOptions,
): string {
	return [
		`${name}=${value}`,
		`Path=${options.path}`,
		`Max-Age=${options.maxAgeSeconds}`,
		"HttpOnly",
		"SameSite=Lax",
		...(options.secure ? ["Secure"] : []),
	].join("; ");
}
