import { attemptAsync } from "@flash/typekit";
import { callApi, STATUS } from "../api";
import { createSaleClient, type SaleClient } from "../sale/client";
import { createWatcher, type Watcher } from "../sale/sse";
import { type AuthClient, createAuthClient } from "./client";
import type { Account } from "./types";

// Everything the page asks of the web server: the sale, the account, and a way to hear that the login ended.
export type WebApi = {
	sale: SaleClient;
	auth: AuthClient;
	// Calls `listener` when a request found the login gone and a refresh could not bring it back. Returns a way to stop.
	onExpired: (listener: () => void) => () => void;
};

// Wraps a fetch so that a reply "not_authenticated" is tried once more after the refresh token has been traded for new
// cookies. The access token lives 15 minutes, so a shopper who waits in the queue would otherwise be thrown out. Several
// requests that fail together share one refresh, because the refresh token can be used only once.
export function withRefresh(
	base: string,
	fetcher: typeof fetch,
	onExpired: () => void,
): typeof fetch {
	let refreshing: Promise<boolean> | undefined;
	const refresh = (): Promise<boolean> => {
		refreshing ??= (async () => {
			const traded = await callApi<Account>(
				fetcher,
				`${base}/api/auth/refresh`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
				},
			);
			return traded.isOk();
		})().finally(() => {
			refreshing = undefined;
		});
		return refreshing;
	};
	const isLoginLost = async (reply: Response): Promise<boolean> => {
		if (reply.status !== STATUS.unauthorized) return false;
		const body = await attemptAsync(
			async () => (await reply.clone().json()) as { errorCode?: unknown },
			Error,
		);
		return body.isOk() && body.value.errorCode === "not_authenticated";
	};
	return async (input, init) => {
		const reply = await fetcher(input, init);
		if (!(await isLoginLost(reply))) return reply;
		if (await refresh()) return fetcher(input, init);
		onExpired();
		return reply;
	};
}

// The clients of the page, all sharing one fetch that renews the login. `base` is empty in the browser and a full address
// in tests. The event streams use the same fetch, so a stream that finds the login gone renews it too.
export function createWebApi(
	base = "",
	fetcher: typeof fetch = fetch,
	options: { watch?: Watcher; retryMs?: number } = {},
): WebApi {
	const listeners = new Set<() => void>();
	const session = withRefresh(base, fetcher, () => {
		for (const listener of [...listeners]) listener();
	});
	return {
		sale: createSaleClient(
			base,
			session,
			options.watch ??
				createWatcher({
					fetcher: session,
					...(options.retryMs === undefined
						? {}
						: { retryMs: options.retryMs }),
				}),
		),
		auth: createAuthClient(base, session),
		onExpired: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
