import { type FormEvent, useEffect, useMemo, useState } from "react";
import { SaleTime } from "../components/sale-time";
import { Spinner } from "../components/spinner";
import { createSaleClient, type SaleClient } from "./client";
import { STATUS_LABEL, STATUS_NOTE, TEXT } from "./messages";
import type { SaleLoad, SaleStatus, SaleView } from "./types";
import { type Phase, useShopper } from "./use-shopper";

// Follows the sale as the server pushes changes. Starts from what the server rendered.
function useLiveSale(initial: SaleView | undefined, client: SaleClient) {
	const [sale, setSale] = useState(initial);
	const id = initial?.id;
	useEffect(() => {
		if (!id) return;
		return client.watchSale(id, setSale);
	}, [id, client]);
	return sale;
}

export function SalePage({
	load,
	client,
}: {
	load: SaleLoad;
	client?: SaleClient;
}) {
	const saleClient = useMemo(() => client ?? createSaleClient(), [client]);
	const sale = useLiveSale(
		load.state === "ok" ? load.sale : undefined,
		saleClient,
	);

	if (!sale) {
		// No sale is not a failure, so it is a calm note. A sale that could not be read is an alert.
		return load.state === "error" ? (
			<div
				role="alert"
				className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"
			>
				<p className="font-medium">{TEXT.loadFailed}</p>
				<p className="mt-1 text-sm">{TEXT.loadFailedHint}</p>
			</div>
		) : (
			<div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
				<p className="text-lg font-medium text-slate-700 dark:text-slate-300">
					{TEXT.noSale}
				</p>
				<p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
					{TEXT.noSaleHint}
				</p>
			</div>
		);
	}
	return <SaleShop sale={sale} client={saleClient} />;
}

// How each sale status looks. The text always says it too, so colour is never the only signal.
const BADGE: Record<SaleStatus, string> = {
	upcoming:
		"bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
	active:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
	sold_out: "bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-200",
	ended: "bg-slate-200 text-slate-800 dark:bg-slate-700/60 dark:text-slate-200",
};

// The message under the buttons takes a calm tone for the two phases that matter: an item is held, or it is bought.
const NOTE_TONE: Partial<Record<Phase["kind"], string>> = {
	holding:
		"bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
	purchased:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
};
const NOTE_BASE =
	"bg-slate-100 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300";

const CARD =
	"rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900";
const FOCUS =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:focus-visible:outline-sky-400";
const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium motion-safe:transition-colors disabled:cursor-not-allowed ${FOCUS}`;
const OUTLINE =
	"border border-slate-300 text-slate-800 hover:bg-slate-100 disabled:text-slate-500 disabled:hover:bg-transparent dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-transparent";

// The part of the page that exists only when there is a sale to buy from.
function SaleShop({ sale, client }: { sale: SaleView; client: SaleClient }) {
	const shopper = useShopper(sale.id, sale.status, client);
	const [name, setName] = useState("");

	const phase = shopper.phase.kind;
	const busy = phase === "busy" || phase === "waiting";
	// The spinner goes on the button that was pressed. A shopper in the queue is still buying.
	const action = shopper.phase.kind === "busy" ? shopper.phase.action : "";
	const buying = action === "buy" || phase === "waiting";
	const canBuy = sale.status === "active" && !busy && phase !== "holding";
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (canBuy) void shopper.buy(name);
	};
	// What is left of the stock, from 0 to 1, for the bar.
	const left = sale.stock > 0 ? Math.min(1, sale.remaining / sale.stock) : 0;

	return (
		<section
			aria-labelledby="sale-name"
			className="grid gap-5 md:grid-cols-2 md:items-start md:gap-6"
		>
			<div className={CARD}>
				<h2 id="sale-name" className="text-xl font-semibold">
					{sale.name}
				</h2>
				<p className="mt-4 flex items-center gap-2 text-slate-600 dark:text-slate-400">
					Status:{" "}
					<strong
						className={`rounded-full px-3 py-0.5 text-sm font-medium ${BADGE[sale.status]}`}
					>
						{STATUS_LABEL[sale.status]}
					</strong>
				</p>
				<p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
					{STATUS_NOTE[sale.status]}
				</p>
				<dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
					<dt>Opens</dt>
					<dd className="text-slate-900 dark:text-slate-100">
						<SaleTime iso={sale.startsAt} />
					</dd>
					<dt>Closes</dt>
					<dd className="text-slate-900 dark:text-slate-100">
						<SaleTime iso={sale.endsAt} />
					</dd>
				</dl>
				<p className="mt-6 flex items-baseline gap-2 text-slate-600 dark:text-slate-400">
					Items left:{" "}
					<strong className="text-4xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
						{sale.remaining}
					</strong>
				</p>
				<div
					aria-hidden="true"
					className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
				>
					<div
						className="h-full origin-left rounded-full bg-emerald-600 motion-safe:transition-transform dark:bg-emerald-500"
						style={{ transform: `scaleX(${left})` }}
					/>
				</div>
			</div>

			<div className={`${CARD} flex flex-col gap-4`}>
				<form
					onSubmit={submit}
					aria-busy={busy}
					className="flex flex-col gap-4"
				>
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Your name{" "}
						<input
							name="name"
							autoComplete="off"
							value={name}
							onChange={(event) => setName(event.target.value)}
							className={`h-11 rounded-lg border border-slate-300 bg-white px-3 text-base font-normal text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${FOCUS}`}
						/>
					</label>
					<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
						<button
							type="submit"
							disabled={!canBuy}
							className={`${BUTTON} bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-slate-800`}
						>
							{buying && <Spinner />}
							Buy Now
						</button>
						<button
							type="button"
							disabled={phase === "busy"}
							onClick={() => void shopper.check(name)}
							className={`${BUTTON} ${OUTLINE}`}
						>
							{action === "check" && <Spinner />}
							Check my status
						</button>
					</div>
				</form>
				<button
					type="button"
					disabled={phase !== "holding"}
					onClick={() => void shopper.confirm()}
					className={`${BUTTON} ${OUTLINE} enabled:border-transparent enabled:bg-emerald-700 enabled:text-white enabled:hover:bg-emerald-800 dark:enabled:bg-emerald-500 dark:enabled:text-slate-950 dark:enabled:hover:bg-emerald-400`}
				>
					{action === "confirm" && <Spinner />}
					Confirm purchase
				</button>
				<p
					role="status"
					aria-live="polite"
					aria-busy={busy}
					className={`min-h-12 rounded-lg px-3 py-2.5 text-sm leading-6 ${shopper.text ? (NOTE_TONE[phase] ?? NOTE_BASE) : ""}`}
				>
					<span className="flex items-start gap-2">
						{busy && (
							<span className="mt-1">
								<Spinner />
							</span>
						)}
						<span>{shopper.text}</span>
					</span>
					{phase === "waiting" && (
						<span className="mt-1 block text-xs opacity-80">
							{TEXT.waitingHint}
						</span>
					)}
				</p>
			</div>
		</section>
	);
}
