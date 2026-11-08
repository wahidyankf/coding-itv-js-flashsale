// What a browser does with cookies, as far as the scenarios need: keep what `Set-Cookie` says, forget what it empties, and
// send a cookie only to the paths it was set for. The rules are shared in @flash/flash-commons; this module keeps the jar a
// scenario holds. The refresh cookie depends on that rule.
import {
	applySetCookies,
	cookieHeader,
	type CookieJar as Jar,
} from "@flash/flash-commons";

// The jar a world holds. Named here so the worlds can pass it around without repeating its type.
export type CookieJar = ReturnType<typeof createCookieJar>;

// Keeps the browser's cookies the way a browser does, so a scenario sees what a shopper's browser would send.
export function createCookieJar() {
	let cookies: Jar = new Map();

	return {
		store(setCookies: string[]): void {
			cookies = applySetCookies(cookies, setCookies);
		},
		// The `Cookie` header for a request to `path`, or nothing.
		header(path: string): string | undefined {
			return cookieHeader(cookies, path);
		},
		pathOf: (name: string) => cookies.get(name)?.path,
		has: (name: string) => cookies.has(name),
		clear: () => {
			cookies = new Map();
		},
	};
}

// The cookies of a reply, one per `Set-Cookie` header.
export const setCookiesOf = (headers: Headers): string[] =>
	headers.getSetCookie();
