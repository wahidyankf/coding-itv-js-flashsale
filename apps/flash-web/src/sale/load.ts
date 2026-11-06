import { createClient, type Fetch, routes } from "@flash/contract";
import { buildConfig } from "../config";
import type { SaleLoad } from "./types";

// Asks flash-be for the current sale, on the server. A sale that is missing and a sale that cannot be read are told
// apart, so the page can say which.
export async function loadSale(
	env: NodeJS.ProcessEnv,
	fetcher: Fetch = fetch,
): Promise<SaleLoad> {
	const api = createClient({
		baseUrl: buildConfig(env).backendUrl,
		fetch: fetcher,
	});
	const found = await api.call(routes.currentSale, {});
	return found.match({
		ok: (reply): SaleLoad => ({ state: "ok", sale: reply.body }),
		err: (failure): SaleLoad =>
			failure.error === "sale_not_found"
				? { state: "none" }
				: { state: "error" },
	});
}
