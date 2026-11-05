import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type BackendStatus, loadBackendStatus } from "../backend";
import { BackendStatusView } from "../components/backend-status";

// Runs on the server only. process.env is read here, never in the browser bundle.
export async function backendStatusHandler(): Promise<BackendStatus> {
	return loadBackendStatus(process.env);
}

const getBackendStatus = createServerFn({ method: "GET" }).handler(
	backendStatusHandler,
);

export function HomePage({ status }: { status: BackendStatus }) {
	return (
		<main>
			<h1>Flash Sale</h1>
			<BackendStatusView status={status} />
		</main>
	);
}

export const Route = createFileRoute("/")({
	loader: () => getBackendStatus(),
	component: () => <HomePage status={Route.useLoaderData()} />,
});
