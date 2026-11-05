import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createSaleClient, type SaleClient } from "./client";
import { STATUS_LABEL, TEXT } from "./messages";
import type { SaleLoad, SaleView } from "./types";
import { useShopper } from "./use-shopper";

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
		return load.state === "error" ? (
			<p role="alert">{TEXT.loadFailed}</p>
		) : (
			<p>{TEXT.noSale}</p>
		);
	}
	return <SaleShop sale={sale} client={saleClient} />;
}

// The part of the page that exists only when there is a sale to buy from.
function SaleShop({ sale, client }: { sale: SaleView; client: SaleClient }) {
	const shopper = useShopper(sale.id, sale.status, client);
	const [name, setName] = useState("");

	const phase = shopper.phase.kind;
	const busy = phase === "busy" || phase === "waiting";
	const canBuy = sale.status === "active" && !busy && phase !== "holding";
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (canBuy) void shopper.buy(name);
	};

	return (
		<section aria-labelledby="sale-name">
			<h2 id="sale-name">{sale.name}</h2>
			<p>
				Status: <strong>{STATUS_LABEL[sale.status]}</strong>
			</p>
			<p>
				Items left: <strong>{sale.remaining}</strong>
			</p>
			<form onSubmit={submit}>
				<label>
					Your name{" "}
					<input
						name="name"
						autoComplete="off"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>{" "}
				<button type="submit" disabled={!canBuy}>
					Buy Now
				</button>{" "}
				<button
					type="button"
					disabled={phase === "busy"}
					onClick={() => void shopper.check(name)}
				>
					Check my status
				</button>
			</form>
			<p>
				<button
					type="button"
					disabled={phase !== "holding"}
					onClick={() => void shopper.confirm()}
				>
					Confirm purchase
				</button>
			</p>
			<p role="status" aria-live="polite">
				{shopper.text}
			</p>
		</section>
	);
}
