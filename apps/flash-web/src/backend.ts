// Asks flash-be whether it is up. Server-side only; the page shows the answer as "ok" or "down".
import { literal, object } from "@flash/flash-commons";
import { callApi } from "./api";
import { buildConfig } from "./config";

// Whether flash-be answers: "ok" when it does, "down" when it does not or cannot be reached.
export type BackendStatus = "ok" | "down";

// The reply of flash-be's liveness check, `{ "status": "ok" }`. Any other reply does not decode, so it counts as down.
export const decodeBackendHealth = object({ status: literal("ok") });

// Asks flash-be for its liveness. Any failure is reported as "down" so the page still renders.
export async function fetchBackendHealth(
	backendUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<BackendStatus> {
	const asked = await callApi(
		fetcher,
		`${backendUrl}/health`,
		decodeBackendHealth,
	);
	return asked.isOk() ? "ok" : "down";
}

// Reads the backend address from the given environment, then asks flash-be for its status.
export function loadBackendStatus(
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<BackendStatus> {
	return fetchBackendHealth(buildConfig(env).backendUrl, fetcher);
}
