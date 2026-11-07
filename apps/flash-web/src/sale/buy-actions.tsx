// The buying card for a shopper who is logged in: Buy Now, Check my status, Confirm purchase, and the sentence that says
// what is happening, and the Purchase ID once a purchase is confirmed. The state comes in as props, and the buttons only
// report presses. Each button's spinner marks the request it started, so the shopper can see which one is working.
import type { FormEvent } from "react";
import { Spinner } from "../components/spinner";
import {
	CONFIRM,
	MESSAGE_BOX,
	PRIMARY,
	SECONDARY_BUTTON,
	TONE,
} from "../components/ui";
import { TEXT } from "./messages";
import { type Phase, purchaseIdText, shopperFlags } from "./shopper-state";
import type { SaleStatus } from "./types";

// The sentence's colour follows the phase: a hold and a purchase are the two calm highlights, everything else is plain.
const NOTE_TONE: Partial<Record<Phase["kind"], string>> = {
	holding: TONE.amber,
	purchased: TONE.emerald,
};
const NOTE_BASE =
	"bg-slate-100 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300";

// What the buying card needs: the phase, the sale's status, the sentence, and the three presses.
export type BuyActionsProps = {
	phase: Phase;
	saleStatus: SaleStatus;
	// The sentence under the buttons, already worked out from the phase.
	text: string;
	// True once the live updates have stopped. The waiting hint then goes, because it says the page updates by itself.
	liveStopped: boolean;
	onBuy: () => void;
	onCheck: () => void;
	onConfirm: () => void;
};

// The buying card's buttons and the status sentence. The buttons only report presses; the page decides what happens.
export function BuyActions({
	phase,
	saleStatus,
	text,
	liveStopped,
	onBuy,
	onCheck,
	onConfirm,
}: BuyActionsProps) {
	const { busy, buying, canBuy, action } = shopperFlags(phase, saleStatus);
	// The id is shown in full, with no copy button, so the shopper can note it down.
	const purchase = purchaseIdText(phase);
	// Enter in a form submits it, so the form checks the same rule as the button before it buys.
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (canBuy) onBuy();
	};

	return (
		<>
			<form
				onSubmit={submit}
				aria-busy={busy}
				className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2"
			>
				<button type="submit" disabled={!canBuy} className={PRIMARY}>
					{buying && <Spinner />}
					{TEXT.buyNow}
				</button>
				<button
					type="button"
					disabled={phase.kind === "busy"}
					onClick={onCheck}
					className={SECONDARY_BUTTON}
				>
					{action === "check" && <Spinner />}
					{TEXT.checkStatus}
				</button>
			</form>
			<button
				type="button"
				disabled={phase.kind !== "holding"}
				onClick={onConfirm}
				className={CONFIRM}
			>
				{action === "confirm" && <Spinner />}
				{TEXT.confirmPurchase}
			</button>
			<p
				role="status"
				aria-live="polite"
				aria-busy={busy}
				className={`min-h-12 ${MESSAGE_BOX} ${text ? (NOTE_TONE[phase.kind] ?? NOTE_BASE) : ""}`}
			>
				<span className="flex items-start gap-2">
					{busy && (
						<span className="mt-1">
							<Spinner />
						</span>
					)}
					<span>{text}</span>
				</span>
				{phase.kind === "waiting" && !liveStopped && (
					<span className="mt-1 block text-xs opacity-80">
						{TEXT.waitingHint}
					</span>
				)}
				{purchase && (
					<span className="mt-1 block break-all font-mono">{purchase}</span>
				)}
			</p>
		</>
	);
}
