// The browser's calls for the account: who am I, sign up, log in, and log out. Each one goes to the web server, which
// passes it on to flash-be and carries the cookies. The page gets this client, so a test can give it a fake.
import { type ApiResult, callApi, jsonPost } from "../api";
import type { Account } from "./types";

// What the page asks of the account, in one place.
export type AuthClient = {
	me: () => Promise<ApiResult<Account>>;
	register: (username: string, password: string) => Promise<ApiResult<Account>>;
	login: (username: string, password: string) => Promise<ApiResult<Account>>;
	logout: () => Promise<ApiResult<unknown>>;
};

// The routes are under /api/auth on the web server. The tokens are only ever in the cookies, so the page never sees them.
export function createAuthClient(
	base = "",
	fetcher: typeof fetch = fetch,
): AuthClient {
	const auth = `${base}/api/auth`;
	const post = (body?: object) =>
		jsonPost(body === undefined ? "{}" : JSON.stringify(body));
	return {
		me: () => callApi<Account>(fetcher, `${auth}/me`),
		register: (username, password) =>
			callApi<Account>(
				fetcher,
				`${auth}/register`,
				post({ username, password }),
			),
		login: (username, password) =>
			callApi<Account>(fetcher, `${auth}/login`, post({ username, password })),
		logout: () => callApi<unknown>(fetcher, `${auth}/logout`, post()),
	};
}
