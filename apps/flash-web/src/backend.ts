import { createClient, type Fetch, routes } from "@flash/contract";
import { buildConfig } from "./config";

export type BackendStatus = "ok" | "down";

// Asks flash-be for its liveness. Any failure is reported as "down" so the page still renders.
export async function fetchBackendHealth(
	backendUrl: string,
	fetcher: Fetch = fetch,
): Promise<BackendStatus> {
	const api = createClient({ baseUrl: backendUrl, fetch: fetcher });
	const asked = await api.call(routes.health, {});
	return asked.isOk() ? "ok" : "down";
}

// Reads the backend address from the given environment, then asks flash-be for its status.
export function loadBackendStatus(
	env: NodeJS.ProcessEnv,
	fetcher: Fetch = fetch,
): Promise<BackendStatus> {
	return fetchBackendHealth(buildConfig(env).backendUrl, fetcher);
}
