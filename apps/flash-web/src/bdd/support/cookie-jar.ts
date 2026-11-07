// What a browser does with cookies, as far as the scenarios need: keep what `Set-Cookie` says, forget what it empties, and
// send a cookie only to the paths it was set for. The refresh cookie depends on that rule.
export type CookieJar = ReturnType<typeof createCookieJar>;

// Keeps the browser's cookies the way a browser does, so a scenario sees what a shopper's browser would send.
export function createCookieJar() {
	const cookies = new Map<string, { value: string; path: string }>();

	return {
		store(setCookies: string[]): void {
			for (const cookie of setCookies) {
				const [pair = "", ...attributes] = cookie
					.split(";")
					.map((part) => part.trim());
				const at = pair.indexOf("=");
				const name = pair.slice(0, at);
				const value = pair.slice(at + 1);
				const path =
					attributes
						.find((a) => a.startsWith("Path="))
						?.slice("Path=".length) ?? "/";
				if (attributes.includes("Max-Age=0")) cookies.delete(name);
				else cookies.set(name, { value, path });
			}
		},
		// The `Cookie` header for a request to `path`, or nothing.
		header(path: string): string | undefined {
			const sent = [...cookies]
				.filter(
					([, cookie]) =>
						cookie.path === "/" ||
						path === cookie.path ||
						path.startsWith(`${cookie.path}/`),
				)
				.map(([name, { value }]) => `${name}=${value}`);
			return sent.length === 0 ? undefined : sent.join("; ");
		},
		pathOf: (name: string) => cookies.get(name)?.path,
		has: (name: string) => cookies.has(name),
		clear: () => cookies.clear(),
	};
}

// The cookies of a reply, one per `Set-Cookie` header.
export const setCookiesOf = (headers: Headers): string[] =>
	headers.getSetCookie();
