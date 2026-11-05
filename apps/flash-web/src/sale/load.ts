import { buildConfig } from "../config";
import type { SaleLoad, SaleView } from "./types";

// Asks flash-be for the current sale, on the server. A sale that is missing and a sale that cannot be read are told
// apart, so the page can say which.
export async function loadSale(
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<SaleLoad> {
	try {
		const reply = await fetcher(`${buildConfig(env).backendUrl}/sales/current`);
		if (reply.status === 404) return { state: "none" };
		if (!reply.ok) return { state: "error" };
		return { state: "ok", sale: (await reply.json()) as SaleView };
	} catch {
		return { state: "error" };
	}
}
