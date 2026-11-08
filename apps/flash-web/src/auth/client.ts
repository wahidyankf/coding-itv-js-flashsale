// Browser only, part of the account feature. The browser's calls for the account: who am I, sign up, log in, and log out. Each one goes to the web server, which
// passes it on to flash-be and carries the cookies. The page gets this client, so a test can give it a fake.
import { API_PATHS, object } from "@flash/flash-commons";
import { type ApiResult, callApi, jsonPost } from "../api";
import { type Account, decodeAccount } from "./types";

// The logout reply is an empty object. The page does not read it, but it must still be an object.
const decodeLoggedOut = object({});

// What the page asks of the account, in one place.
export type AuthClient = {
	me: () => Promise<ApiResult<Account>>;
	register: (username: string, password: string) => Promise<ApiResult<Account>>;
	login: (username: string, password: string) => Promise<ApiResult<Account>>;
	logout: () => Promise<ApiResult<unknown>>;
};

// The routes come from the path table. The tokens are only ever in the cookies, so the page never sees them.
export function createAuthClient(
	base = "",
	fetcher: typeof fetch = fetch,
): AuthClient {
	const post = (body?: object) =>
		jsonPost(body === undefined ? "{}" : JSON.stringify(body));
	return {
		me: () => callApi(fetcher, `${base}${API_PATHS.authMe}`, decodeAccount),
		register: (username, password) =>
			callApi(
				fetcher,
				`${base}${API_PATHS.authRegister}`,
				decodeAccount,
				post({ username, password }),
			),
		login: (username, password) =>
			callApi(
				fetcher,
				`${base}${API_PATHS.authLogin}`,
				decodeAccount,
				post({ username, password }),
			),
		logout: () =>
			callApi(
				fetcher,
				`${base}${API_PATHS.authLogout}`,
				decodeLoggedOut,
				post(),
			),
	};
}
