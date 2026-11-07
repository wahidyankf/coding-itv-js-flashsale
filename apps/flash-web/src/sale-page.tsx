// The sale page: the sale card, the buying card and the account line, put together for a shopper. It is the one place the
// sale and the account meet, so it sits in src/ and neither the sale nor the account folder imports the other.
import { useEffect, useMemo, useState } from "react";
import { AccountBar } from "./auth/account-bar";
import { AuthCard } from "./auth/auth-card";
import { AUTH_TEXT } from "./auth/messages";
import { useAccount } from "./auth/use-account";
import { Spinner } from "./components/spinner";
import { CARD, MUTED_TEXT } from "./components/ui";
import { BuyActions } from "./sale/buy-actions";
import type { SaleLoad } from "./sale/load";
import { TEXT } from "./sale/messages";
import { SaleStatusCard } from "./sale/sale-status-card";
import type { SaleView } from "./sale/types";
import { useShopper } from "./sale/use-shopper";
import { createWebApi, type WebApi } from "./web-api";

// A card for "no sale" and for "the sale could not be read". The first is calm; the second is an alert.
const ALERT_CARD =
	"rounded-2xl border border-rose-300 bg-rose-50 p-6 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200";
const EMPTY_CARD =
	"rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700";

// Follows the sale as the server pushes changes. Starts from what the server rendered.
function useLiveSale(initial: SaleView | undefined, client: WebApi["sale"]) {
	const [sale, setSale] = useState(initial);
	const id = initial?.id;
	useEffect(() => {
		if (!id) return;
		return client.watchSale(id, setSale);
	}, [id, client]);
	return sale;
}

// The page for one load of the sale. `api` is given by tests; the browser builds its own.
export function SalePage({ load, api }: { load: SaleLoad; api?: WebApi }) {
	const web = useMemo(() => api ?? createWebApi(), [api]);
	const sale = useLiveSale(
		load.state === "ok" ? load.sale : undefined,
		web.sale,
	);

	if (!sale) {
		// No sale is not a failure, so it is a calm note. A sale that could not be read is an alert.
		return load.state === "error" ? (
			<div role="alert" className={ALERT_CARD}>
				<p className="font-medium">{TEXT.loadFailed}</p>
				<p className="mt-1 text-sm">{TEXT.loadFailedHint}</p>
			</div>
		) : (
			<div className={EMPTY_CARD}>
				<p className="text-lg font-medium text-slate-700 dark:text-slate-300">
					{TEXT.noSale}
				</p>
				<p className={`mt-2 text-sm ${MUTED_TEXT}`}>{TEXT.noSaleHint}</p>
			</div>
		);
	}
	return <SaleShop sale={sale} web={web} />;
}

// The part of the page that exists only when there is a sale to buy from. It asks who is logged in, and gives the right
// card what the account is doing: a "checking" line, the login form, or the buying buttons.
function SaleShop({ sale, web }: { sale: SaleView; web: WebApi }) {
	const account = useAccount(web.auth, web.onExpired);
	const shopper = useShopper({
		saleId: sale.id,
		saleStatus: sale.status,
		client: web.sale,
		loggedIn: account.state.kind === "in",
	});

	return (
		<section
			aria-labelledby="sale-name"
			className="grid gap-5 md:grid-cols-2 md:items-start md:gap-6"
		>
			{account.state.kind === "in" && (
				<AccountBar
					username={account.state.account.username}
					onLogOut={() => void account.leave()}
				/>
			)}
			<SaleStatusCard sale={sale} />
			<div className={`${CARD} flex flex-col gap-4`}>
				{account.state.kind === "checking" && (
					<p
						role="status"
						aria-busy="true"
						className={`flex items-center gap-2 text-sm ${MUTED_TEXT}`}
					>
						<Spinner />
						{AUTH_TEXT.checking}
					</p>
				)}
				{account.state.kind === "anonymous" && (
					<AuthCard notice={account.state.notice} enter={account.enter} />
				)}
				{account.state.kind === "in" && (
					<BuyActions
						phase={shopper.phase}
						saleStatus={sale.status}
						text={shopper.text}
						onBuy={() => void shopper.buy()}
						onCheck={() => void shopper.check()}
						onConfirm={() => void shopper.confirm()}
					/>
				)}
			</div>
		</section>
	);
}
