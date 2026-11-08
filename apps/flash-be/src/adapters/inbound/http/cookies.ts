// The cookies of a login, as HTTP carries them. The domain says how long a login lasts; this file says how a cookie
// is written and read. The access cookie goes with every request, the refresh cookie only to the auth routes.

// The access token's cookie. The browser sends it with every request.
export const ACCESS_COOKIE = "access_token";
// The refresh token's cookie. The token is used once, then replaced.
export const REFRESH_COOKIE = "refresh_token";
// The only path the refresh cookie is sent to, so the token reaches the auth routes alone.
export const REFRESH_COOKIE_PATH = "/auth";

// A user agent is text from the client, so only this much of it is kept for the record of a login.
const MAX_USER_AGENT_LENGTH = 200;

// Reads one cookie from a `Cookie` header. An empty value counts as missing.
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

// The settings for one login cookie. `secure` comes from `COOKIE_SECURE`, which defaults to on in production.
export type CookieOptions = {
	maxAgeSeconds: number;
	path: string;
	secure: boolean;
};

// Builds a `Set-Cookie` value. HttpOnly keeps page scripts from reading it, and SameSite=Lax stops other sites from
// sending it on a POST.
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

// The user agent for a login record: at most `MAX_USER_AGENT_LENGTH` characters, or nothing when it is not text.
export function cutUserAgent(raw: unknown): string | undefined {
	return typeof raw === "string"
		? raw.slice(0, MAX_USER_AGENT_LENGTH)
		: undefined;
}
