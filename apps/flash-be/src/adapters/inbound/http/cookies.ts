// The cookies of a login, as HTTP carries them. The domain says how long a login lasts; this file says how a cookie
// is written and read. The access cookie goes with every request, the refresh cookie only to the auth routes.

// The two cookies of a login. The access token is short and goes with every request. The refresh token lives longer,
// is sent only to the auth routes, and is replaced each time it is used.
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const REFRESH_COOKIE_PATH = "/auth";

// A user agent is text from the client, so only this much of it is kept for the record of a login.
const MAX_USER_AGENT_LENGTH = 200;

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

// How a `Set-Cookie` value is written: its lifetime, the path it is sent to, and whether it needs HTTPS.
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

// The user agent kept for the record of a login: the start of the text, or nothing when the client sent no text.
export function cutUserAgent(raw: unknown): string | undefined {
	return typeof raw === "string"
		? raw.slice(0, MAX_USER_AGENT_LENGTH)
		: undefined;
}
