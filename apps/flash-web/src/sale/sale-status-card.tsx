// The card with what the shopper sees about the sale itself: its name, status, window and stock. It only shows; the
// buying card next to it holds the buttons. The status is always written out, so colour is never the only signal.
import { SaleTime } from "../components/sale-time";
import { CARD, MUTED_TEXT, STRONG_TEXT, TONE } from "../components/ui";
import { STATUS_LABEL, STATUS_NOTE, TEXT } from "./messages";
import { StockMeter } from "./stock-meter";
import type { SaleStatus, SaleView } from "./types";

// How each sale status looks. The words next to it say the same, so colour is never the only signal.
const BADGE: Record<SaleStatus, string> = {
	upcoming: TONE.amber,
	active: TONE.emerald,
	sold_out: TONE.rose,
	ended: TONE.slate,
};

// The sale's own card: its name, status, window and stock.
export function SaleStatusCard({ sale }: { sale: SaleView }) {
	return (
		<div className={CARD}>
			<h2 id="sale-name" className="text-xl font-semibold">
				{sale.name}
			</h2>
			<p className={`mt-4 flex items-center gap-2 ${MUTED_TEXT}`}>
				{TEXT.status}{" "}
				<strong
					className={`rounded-full px-3 py-0.5 text-sm font-medium ${BADGE[sale.status]}`}
				>
					{STATUS_LABEL[sale.status]}
				</strong>
			</p>
			<p className={`mt-3 text-sm ${MUTED_TEXT}`}>{STATUS_NOTE[sale.status]}</p>
			<dl
				className={`mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm ${MUTED_TEXT}`}
			>
				<dt>{TEXT.opens}</dt>
				<dd className={STRONG_TEXT}>
					<SaleTime iso={sale.startsAt} />
				</dd>
				<dt>{TEXT.closes}</dt>
				<dd className={STRONG_TEXT}>
					<SaleTime iso={sale.endsAt} />
				</dd>
			</dl>
			<p className={`mt-6 flex items-baseline gap-2 ${MUTED_TEXT}`}>
				{TEXT.itemsLeft}{" "}
				<strong className="text-4xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
					{sale.remaining}
				</strong>
			</p>
			<StockMeter remaining={sale.remaining} stock={sale.stock} />
		</div>
	);
}
