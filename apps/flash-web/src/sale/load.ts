import { callApi } from "../api";
import { buildConfig } from "../config";
import type { SaleLoad, SaleView } from "./types";

// Asks flash-be for the current sale, on the server. A sale that is missing and a sale that cannot be read are told
// apart, so the page can say which.
export async function loadSale(
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<SaleLoad> {
	const found = await callApi<SaleView>(
		fetcher,
		`${buildConfig(env).backendUrl}/sales/current`,
	);
	return found.match({
		ok: (sale): SaleLoad => ({ state: "ok", sale }),
		err: (failure): SaleLoad =>
			failure.errorCode === "sale_not_found"
				? { state: "none" }
				: { state: "error" },
	});
}
