// The shopper's side of the accounts scenarios: a cookie jar that keeps cookies the way a browser does, and the requests
// a shopper sends. Each layer supplies its app, how an access token ends, and what the stores hold.
import {
	applySetCookies,
	type CookieJar,
	cookieHeader,
} from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { sendRequest } from "./http.js";
import type { Response } from "./response.js";

// The reply type the auth steps read, re-exported so a caller of this world needs no second import.
export type { Response };

// The audit fields of a user's row: who changed it last and when, and the last login. Empty fields are undefined.
export type UserRow = {
	id: string;
	lastLoginAt: Date | undefined;
	updatedAt: Date | undefined;
	updatedBy: string | undefined;
};

// What differs between layers: the app, how an access token ends, and what the stores hold.
export type AuthLayer = {
	app: () => FastifyInstance;
	// Makes the access token end, as the passing of its 15 minutes does.
	expireAccess: (accessToken: string) => Promise<void>;
	// What is stored: the password hashes, and the hashes of the tokens.
	stored: () => Promise<{ passwordHashes: string[]; tokenHashes: string[] }>;
	// The row of the live user with this name, if there is one.
	userRow: (username: string) => Promise<UserRow | undefined>;
	// A second instance of the API over the same stores, as a second server behind a load balancer is.
	secondApp: () => FastifyInstance;
	// Makes a sale that is open now, for a shopper's write, and returns its id.
	openSale: () => Promise<string>;
};

// Which instance of the API a request goes to. The browser and its cookies stay the same.
export type Instance = "first" | "second";

type Jar = CookieJar;

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
	let saleId = "";

	const take = (reply: Response, record = true) => {
		last = reply;
		if (record) jar = applySetCookies(jar, setCookiesOf(reply));
		return reply;
	};
	const send = (
		method: "GET" | "POST",
		url: string,
		options: {
			payload?: unknown;
			from?: Jar;
			record?: boolean;
			on?: Instance | undefined;
		} = {},
	) => {
		const cookie = cookieHeader(options.from ?? jar, url);
		const app = options.on === "second" ? layer.secondApp() : layer.app();
		return sendRequest(app, method, url, {
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
			send("POST", "/api/v1/auth/register", {
				payload: { username, password },
			}),
		logIn: (username: unknown, password: unknown) =>
			send("POST", "/api/v1/auth/login", { payload: { username, password } }),
		me: (on?: Instance) => send("GET", "/api/v1/auth/me", { on }),
		logOut: (on?: Instance) => send("POST", "/api/v1/auth/logout", { on }),
		refresh: (on?: Instance) => send("POST", "/api/v1/auth/refresh", { on }),
		async openSale() {
			saleId = await layer.openSale();
		},
		// A shopper's write: joining the queue of the sale the scenario opened.
		joinQueue: (on?: Instance) =>
			send("POST", `/api/v1/sales/${saleId}/queue`, { on }),
		keepCopy: () => {
			copy = new Map(jar);
		},
		// No cookies, so the reply is the one a visitor who is not logged in gets.
		anonymous: (method: "GET" | "POST", url: string) =>
			send(method, url, { from: new Map() }),
		// The copy of the tokens from before, sent as a thief would send it. What the reply sets does not reach the jar.
		meWithCopy: (on?: Instance) =>
			send("GET", "/api/v1/auth/me", { from: copy, record: false, on }),
		refreshWithCopy: (on?: Instance) =>
			send("POST", "/api/v1/auth/refresh", { from: copy, record: false, on }),
		expireAccess: () => layer.expireAccess(cookieValueOf(jar, "access_token")),
		stored: layer.stored,
		userRow: layer.userRow,
		// The jar after the last reply, to see which tokens are still held.
		holds: (name: string) => jar.has(name),
		forgetJar: () => {
			jar = new Map();
		},
	};
}

// The shopper's world a scenario is built from, whichever layer makes it. The auth steps are bound over this type.
export type AuthWorld = ReturnType<typeof authWorld>;
