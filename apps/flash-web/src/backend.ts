export type BackendStatus = "ok" | "down";

// Asks flash-be for its liveness. Any failure is reported as "down" so the page still renders.
export async function fetchBackendHealth(
	backendUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<BackendStatus> {
	try {
		const response = await fetcher(`${backendUrl}/health`);
		if (!response.ok) return "down";

		const body = (await response.json()) as { status?: string };
		return body.status === "ok" ? "ok" : "down";
	} catch {
		return "down";
	}
}
