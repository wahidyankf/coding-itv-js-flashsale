// The home route. Loads the backend status and the sale on the server, then renders the sale page.
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { type BackendStatus, loadBackendStatus } from "../backend";
import { BackendStatusView } from "../components/backend-status";
import { loadSale, type SaleLoad } from "../sale/load";
import { TEXT } from "../sale/messages";
import { SalePage } from "../sale-page";

// What the home route loads on the server: the backend status and the sale.
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

// The frame both the page and its loading state sit in, so nothing jumps when the real page arrives.
function PageFrame({ children }: { children: ReactNode }) {
	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
			<h1 className="mb-6 text-3xl font-semibold tracking-tight sm:mb-8 sm:text-4xl">
				Flash Sale
			</h1>
			{children}
		</main>
	);
}

// The home page: the sale page, then the backend status.
export function HomePage({
	status,
	sale = { state: "none" },
}: {
	status: BackendStatus;
	sale?: SaleLoad;
}) {
	return (
		<PageFrame>
			<SalePage load={sale} />
			<BackendStatusView status={status} />
		</PageFrame>
	);
}

const SKELETON =
	"h-56 rounded-2xl border border-slate-200 bg-slate-100 motion-safe:animate-pulse dark:border-slate-800 dark:bg-slate-900";

// Shown while the page waits for the sale (a visit by link inside the app). The words are for screen readers; the grey
// cards stand where the real cards will be.
export function HomePending() {
	return (
		<PageFrame>
			<div
				role="status"
				aria-busy="true"
				className="grid gap-5 md:grid-cols-2 md:gap-6"
			>
				<span className="sr-only">{TEXT.pending}</span>
				<div aria-hidden="true" className={SKELETON} />
				<div aria-hidden="true" className={SKELETON} />
			</div>
		</PageFrame>
	);
}

// The home route. The loader fetches the data on the server; while it loads, HomePending shows.
export const Route = createFileRoute("/")({
	loader: () => getHomeData(),
	pendingComponent: HomePending,
	component: () => {
		const { status, sale } = Route.useLoaderData();
		return <HomePage status={status} sale={sale} />;
	},
});
