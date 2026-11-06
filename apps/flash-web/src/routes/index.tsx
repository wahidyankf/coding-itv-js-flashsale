import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type BackendStatus, loadBackendStatus } from "../backend";
import { BackendStatusView } from "../components/backend-status";
import { loadSale } from "../sale/load";
import { SalePage } from "../sale/sale-page";
import type { SaleLoad } from "../sale/types";

export type HomeData = { status: BackendStatus; sale: SaleLoad };

// Runs on the server only. process.env is read here, never in the browser bundle.
export async function homeDataHandler(): Promise<HomeData> {
	const [status, sale] = await Promise.all([
		loadBackendStatus(process.env),
		loadSale(process.env),
	]);
	return { status, sale };
}

const getHomeData = createServerFn({ method: "GET" }).handler(homeDataHandler);

export function HomePage({
	status,
	sale = { state: "none" },
}: {
	status: BackendStatus;
	sale?: SaleLoad;
}) {
	return (
		<main>
			<h1>Flash Sale</h1>
			<SalePage load={sale} />
			<BackendStatusView status={status} />
		</main>
	);
}

export const Route = createFileRoute("/")({
	loader: () => getHomeData(),
	component: () => {
		const { status, sale } = Route.useLoaderData();
		return <HomePage status={status} sale={sale} />;
	},
});
