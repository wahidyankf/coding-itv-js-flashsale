// The sale the server renders on the first visit. It runs on the web server only, asks flash-be for the current sale, and
// tells "no sale" apart from "could not read it", so the page can say which.
import { callApi } from "../api";
import { buildConfig } from "../config";
import { decodeSaleView, type SaleView } from "./types";

// What the server knows when the page is first rendered: the sale, no sale yet, or a sale that could not be read.
export type SaleLoad =
	| { state: "ok"; sale: SaleView }
	| { state: "none" }
	| { state: "error" };

// Asks flash-be for the current sale. The page is then shown from this answer, and the live stream takes over.
export async function loadSale(
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<SaleLoad> {
	const found = await callApi(
		fetcher,
		`${buildConfig(env).backendUrl}/sales/current`,
		decodeSaleView,
	);
	return found.match({
		ok: (sale): SaleLoad => ({ state: "ok", sale }),
		err: (failure): SaleLoad =>
			failure.errorCode === "sale_not_found"
				? { state: "none" }
				: { state: "error" },
	});
}
