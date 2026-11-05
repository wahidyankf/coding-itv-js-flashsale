import { attemptAsync } from "@flash/typekit";
import { buildConfig } from "./config";

export type BackendStatus = "ok" | "down";

// Asks flash-be for its liveness. Any failure is reported as "down" so the page still renders.
export async function fetchBackendHealth(
	backendUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<BackendStatus> {
	const asked = await attemptAsync(async (): Promise<BackendStatus> => {
		const response = await fetcher(`${backendUrl}/health`);
		if (!response.ok) return "down";

		const body = (await response.json()) as { status?: string };
		return body.status === "ok" ? "ok" : "down";
	}, Error);
	return asked.isOk() ? asked.value : "down";
}

// Reads the backend address from the given environment, then asks flash-be for its status.
export function loadBackendStatus(
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<BackendStatus> {
	return fetchBackendHealth(buildConfig(env).backendUrl, fetcher);
}
