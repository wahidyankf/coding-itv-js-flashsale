// The shopper's side of the accounts scenarios: a cookie jar that keeps cookies the way a browser does, and the requests
// a shopper sends. Each layer supplies its app, how an access token ends, and what the stores hold.
import type { FastifyInstance } from "fastify";
import { sendRequest } from "./http.js";
import type { Response } from "./response.js";

// The reply type the auth steps read, re-exported so a caller of this world needs no second import.
export type { Response };

// What differs between layers: the app, how an access token ends, and what the stores hold.
export type AuthLayer = {
	app: () => FastifyInstance;
	// Makes the access token end, as the passing of its 15 minutes does.
	expireAccess: (accessToken: string) => Promise<void>;
	// What is stored: the password hashes, and the hashes of the tokens.
	stored: () => Promise<{ passwordHashes: string[]; tokenHashes: string[] }>;
};

type Jar = Map<string, { value: string; path: string }>;

// The cookies of a reply, one per `set-cookie` header.
const setCookiesOf = (reply: Response): string[] => {
	const header = reply.headers["set-cookie"];
	return header === undefined ? [] : [header].flat().map(String);
};

// One scenario of a shopper: a browser's cookie jar, and the last reply. The jar keeps what the replies set and sends
// each cookie only to the paths it was set for, as a browser does.
export function authWorld(layer: AuthLayer) {
	let jar: Jar = new Map();
	let copy: Jar = new Map();
	let last: Response | undefined;

	const take = (reply: Response, record = true) => {
		last = reply;
		if (!record) return reply;
		for (const cookie of setCookiesOf(reply)) {
			const [pair = "", ...attributes] = cookie.split(";").map((p) => p.trim());
			const at = pair.indexOf("=");
			const name = pair.slice(0, at);
			const value = pair.slice(at + 1);
			const path =
				attributes.find((a) => a.startsWith("Path="))?.slice("Path=".length) ??
				"/";
			if (attributes.includes("Max-Age=0")) jar.delete(name);
			else jar.set(name, { value, path });
		}
		return reply;
	};
	const cookieFor = (from: Jar, url: string): string | undefined => {
		const sent = [...from]
			.filter(([, { path }]) => url.startsWith(path))
			.map(([name, { value }]) => `${name}=${value}`);
		return sent.length === 0 ? undefined : sent.join("; ");
	};
	const send = (
		method: "GET" | "POST",
		url: string,
		options: { payload?: unknown; from?: Jar; record?: boolean } = {},
	) => {
		const cookie = cookieFor(options.from ?? jar, url);
		return sendRequest(layer.app(), method, url, {
			cookie,
			payload: options.payload,
		}).then((reply) => take(reply, options.record));
	};
	const cookieValueOf = (from: Jar, name: string) =>
		from.get(name)?.value ?? "";

	return {
		get response(): Response {
			if (last === undefined) throw new Error("no request was sent yet");
			return last;
		},
		get setCookies() {
			return last === undefined ? [] : setCookiesOf(last);
		},
		get tokens() {
			return [...jar.values()].map((cookie) => cookie.value);
		},
		pathOf: (name: string) => jar.get(name)?.path,
		signUp: (username: unknown, password: unknown) =>
			send("POST", "/auth/register", { payload: { username, password } }),
		logIn: (username: unknown, password: unknown) =>
			send("POST", "/auth/login", { payload: { username, password } }),
		me: () => send("GET", "/auth/me"),
		logOut: () => send("POST", "/auth/logout"),
		refresh: () => send("POST", "/auth/refresh"),
		keepCopy: () => {
			copy = new Map(jar);
		},
		// Someone who is not logged in: an empty jar.
		anonymous: (method: "GET" | "POST", url: string) =>
			send(method, url, { from: new Map() }),
		// The copy of the tokens from before, sent as a thief would send it. What the reply sets does not reach the jar.
		meWithCopy: () => send("GET", "/auth/me", { from: copy, record: false }),
		refreshWithCopy: () =>
			send("POST", "/auth/refresh", { from: copy, record: false }),
		expireAccess: () => layer.expireAccess(cookieValueOf(jar, "access_token")),
		stored: layer.stored,
		// The jar after the last reply, to see which tokens are still held.
		holds: (name: string) => jar.has(name),
		forgetJar: () => {
			jar = new Map();
		},
	};
}

// The shopper's world a scenario is built from, whichever layer makes it. The auth steps are bound over this type.
export type AuthWorld = ReturnType<typeof authWorld>;
