import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { fetchBackendHealth } from "../backend";
import { BackendStatusView } from "../components/backend-status";
import { buildConfig } from "../config";

const getBackendStatus = createServerFn({ method: "GET" }).handler(async () =>
	fetchBackendHealth(buildConfig(process.env).backendUrl),
);

export const Route = createFileRoute("/")({
	loader: () => getBackendStatus(),
	component: Home,
});

function Home() {
	const status = Route.useLoaderData();

	return (
		<main>
			<h1>Flash Sale</h1>
			<BackendStatusView status={status} />
		</main>
	);
}
