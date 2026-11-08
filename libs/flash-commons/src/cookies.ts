// The cookie jar the apps' tests use, so a test sends the cookies a browser would. Pure: a jar is a value, and each function returns a new one.
// It keeps one cookie per name and reads Max-Age, not Expires, because no app sends Expires.

// One Set-Cookie line, read. `path` is absent when the line names no path, or names one that does not start with "/".
// `expired` is true when the line empties the cookie (Max-Age of zero or less), so a client forgets it.
export type SetCookie = {
	name: string;
	value: string;
	path?: string | undefined;
	httpOnly: boolean;
	expired: boolean;
};

// The path is kept so the jar sends a cookie only to the requests it belongs to.
export type StoredCookie = { value: string; path: string };

// The cookies a client holds, by name.
export type CookieJar = Map<string, StoredCookie>;

// The path a cookie is sent to when its Set-Cookie line names none. RFC 6265 derives it from the request; the apps only
// set cookies on the root path or on an explicit one, so the root is the default here.
const DEFAULT_PATH = "/";
// A Max-Age of zero or less makes the cookie expire at once (RFC 6265 section 5.2.2 and 5.3).
const EXPIRED_AGE = 0;
// A Max-Age must be a whole number. Without this test, an empty value would read as zero and expire the cookie.
const WHOLE_NUMBER = /^-?\d+$/;

// One attribute of a Set-Cookie line, split at its first equals sign. The name is lower case, since attribute names are
// read without regard to case.
function attributeOf(attribute: string): [name: string, value: string] {
	const at = attribute.indexOf("=");
	if (at < 0) return [attribute.toLowerCase(), ""];
	return [
		attribute.slice(0, at).trim().toLowerCase(),
		attribute.slice(at + 1).trim(),
	];
}

// Reads one Set-Cookie line into fields, so the jar and the tests read a reply the same way.
export function parseSetCookie(line: string): SetCookie {
	const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
	const at = pair.indexOf("=");
	const name = at < 0 ? "" : pair.slice(0, at).trim();
	const value = at < 0 ? pair : pair.slice(at + 1).trim();
	const named = attributes.map(attributeOf);
	const find = (wanted: string) => named.find(([key]) => key === wanted)?.[1];
	const path = find("path");
	const maxAge = find("max-age");
	return {
		name,
		value,
		path: path?.startsWith("/") ? path : undefined,
		httpOnly: named.some(([key]) => key === "httponly"),
		expired:
			maxAge !== undefined &&
			WHOLE_NUMBER.test(maxAge) &&
			Number(maxAge) <= EXPIRED_AGE,
	};
}

// Whether a cookie set for `cookiePath` is sent with a request to `requestPath` (RFC 6265 section 5.1.4). `/auth` matches `/auth` and `/auth/me`, not `/authx`.
// The request path has no query string.
export function pathMatches(cookiePath: string, requestPath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	return (
		cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/"
	);
}

// Returns the jar after a reply's Set-Cookie lines, as a browser keeps them. The jar given is not changed, so a copy kept before the reply stays as it was.
export function applySetCookies(
	jar: CookieJar,
	setCookies: readonly string[],
): CookieJar {
	const next: CookieJar = new Map(jar);
	for (const line of setCookies) {
		const cookie = parseSetCookie(line);
		if (cookie.name === "") continue;
		if (cookie.expired) next.delete(cookie.name);
		else
			next.set(cookie.name, {
				value: cookie.value,
				path: cookie.path ?? DEFAULT_PATH,
			});
	}
	return next;
}

// `name=value` for each cookie given, joined as a Cookie header is.
function serialize(entries: [string, StoredCookie][]): string {
	return entries.map(([name, cookie]) => `${name}=${cookie.value}`).join("; ");
}

// The Cookie header a client sends with a request to `requestPath`: the cookies whose path matches, or undefined when none
// does, so the caller sends no header at all.
export function cookieHeader(
	jar: CookieJar,
	requestPath: string,
): string | undefined {
	const sent = [...jar].filter(([, cookie]) =>
		pathMatches(cookie.path, requestPath),
	);
	return sent.length === 0 ? undefined : serialize(sent);
}

// The Cookie header that names every cookie the jar holds, whatever its path, for a client that sends its whole login.
// Empty when the jar holds none.
export function cookieHeaderOf(jar: CookieJar): string {
	return serialize([...jar]);
}
