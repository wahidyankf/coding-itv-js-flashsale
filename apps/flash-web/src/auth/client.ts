import { callApi } from "../api";
import type { ApiResult } from "../sale/types";
import type { Account } from "./types";

// What the page asks of the account, in one place. The page gets a client, so tests can give it a fake.
export type AuthClient = {
	me: () => Promise<ApiResult<Account>>;
	register: (username: string, password: string) => Promise<ApiResult<Account>>;
	login: (username: string, password: string) => Promise<ApiResult<Account>>;
	logout: () => Promise<ApiResult<unknown>>;
};

// The routes are under /api/auth on the web server, which passes them on to flash-be and carries the cookies. The tokens
// are only ever in those cookies: the page never sees them.
export function createAuthClient(
	base = "",
	fetcher: typeof fetch = fetch,
): AuthClient {
	const auth = `${base}/api/auth`;
	const post = (body?: object) => ({
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body === undefined ? "{}" : JSON.stringify(body),
	});
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
