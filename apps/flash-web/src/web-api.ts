// The one set of clients the page uses: sale, account, and a way to hear that the login ended. They share one fetch that
// renews an expired login. It sits in src/, so neither the sale nor the account folder imports the other.
import { API_PATHS, HTTP_STATUS } from "@flash/flash-commons";
import { attemptAsync } from "@flash/typekit";
import { callApi, decodeRefusal, jsonPost, readBody } from "./api";
import { type AuthClient, createAuthClient } from "./auth/client";
import { decodeAccount } from "./auth/types";
import { createSaleClient, type SaleClient } from "./sale/client";
import { createWatcher, type Watcher, type WatchOptions } from "./sale/sse";

// The clients the page uses, in one object, so the login is renewed in one place.
export type WebApi = {
	sale: SaleClient;
	auth: AuthClient;
	// Runs `listener` when the login is gone and a refresh could not restore it. Returns a function that removes it.
	onExpired: (listener: () => void) => () => void;
};

// Wraps a fetch to retry a `not_authenticated` reply once, after a refresh. The access token lasts 15 minutes, so a
// shopper who waits in the queue would otherwise be logged out. Requests that fail together share one refresh, since a
// refresh token works only once.
export function withRefresh(
	base: string,
	fetcher: typeof fetch,
	onExpired: () => void,
): typeof fetch {
	let refreshing: Promise<boolean> | undefined;
	const refresh = (): Promise<boolean> => {
		refreshing ??= (async () => {
			const traded = await callApi(
				fetcher,
				`${base}${API_PATHS.authRefresh}`,
				decodeAccount,
				jsonPost("{}"),
			);
			return traded.isOk();
		})().finally(() => {
			refreshing = undefined;
		});
		return refreshing;
	};
	// Only a 401 that names `not_authenticated` means the login is gone. Other failures, and a body that does not decode,
	// pass back unchanged.
	const isLoginLost = async (reply: Response): Promise<boolean> => {
		if (reply.status !== HTTP_STATUS.unauthorized) return false;
		const body = await attemptAsync(() => reply.clone().text(), Error);
		if (body.isErr()) return false;
		const refusal = readBody(body.value, decodeRefusal);
		return refusal.isOk() && refusal.value.errorCode === "not_authenticated";
	};
	return async (input, init) => {
		const reply = await fetcher(input, init);
		if (!(await isLoginLost(reply))) return reply;
		if (await refresh()) return fetcher(input, init);
		onExpired();
		return reply;
	};
}

// The clients of the page, sharing one fetch that renews the login, so the event streams renew it too. `base` is empty in
// the browser and a full address in tests. `live` sets the stream retry, and `watch` replaces the streams (both for tests).
export function createWebApi(
	base = "",
	fetcher: typeof fetch = fetch,
	options: { watch?: Watcher; live?: Omit<WatchOptions, "fetcher"> } = {},
): WebApi {
	const listeners = new Set<() => void>();
	const session = withRefresh(base, fetcher, () => {
		for (const listener of [...listeners]) listener();
	});
	return {
		sale: createSaleClient(
			base,
			session,
			options.watch ?? createWatcher({ ...options.live, fetcher: session }),
		),
		auth: createAuthClient(base, session),
		onExpired: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
