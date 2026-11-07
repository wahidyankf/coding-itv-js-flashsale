// The shopper's buying state, as a hook. It makes the requests (join the queue, take the hold, pay, check) and runs the
// effects (the countdown, the place stream, the stop when the login goes). The rules it applies live in shopper-state.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiFailure } from "../api";
import type { SaleClient } from "./client";
import { TEXT } from "./messages";
import {
	type Action,
	holdingPhase,
	type Phase,
	phaseText,
	secondsLeft,
} from "./shopper-state";
import type { Place, SaleStatus } from "./types";

// The countdown ticks this often, so the seconds on screen stay within a fraction of a second of the truth.
const COUNTDOWN_MS = 250;

// What the shopper hook needs: the sale, its status, the client, the login, and optionally the clock.
export type ShopperOptions = {
	saleId: string;
	saleStatus: SaleStatus;
	client: SaleClient;
	// Only a shopper who is logged in can buy. When the login goes, whatever the shopper was doing stops.
	loggedIn: boolean;
	// Called when the place stream has given up, so the page can say that its live updates stopped. Must be stable.
	onLiveStopped: () => void;
	// The clock. A test can move it; the page uses the real one.
	now?: () => number;
	// The sentence for an error code. The page passes it, so the sale folder does not import the account's sentences.
	describeError: (errorCode: string, retryAfterSeconds?: number) => string;
};

// The clock that the countdown reads. It moves only while an item is held. When the hold runs out, the shopper is told,
// so the page never counts on an item that is gone.
function useCountdown(
	phase: Phase,
	now: () => number,
	showResult: (text: string) => void,
) {
	const [clock, setClock] = useState(() => now());
	const holding = phase.kind === "holding";
	useEffect(() => {
		if (!holding) return;
		const timer = setInterval(() => setClock(now()), COUNTDOWN_MS);
		return () => clearInterval(timer);
	}, [holding, now]);
	useEffect(() => {
		if (phase.kind === "holding" && phase.expiresAt <= clock) {
			showResult(TEXT.holdEnded);
		}
	}, [phase, clock, showResult]);
	return { clock, setClock };
}

// The line stops moving when the sale ends or sells out, so a waiting shopper is told instead of kept waiting.
function useLineEnd(
	waiting: boolean,
	saleStatus: SaleStatus,
	stop: () => void,
	showResult: (text: string) => void,
	describeError: (errorCode: string, retryAfterSeconds?: number) => string,
) {
	useEffect(() => {
		if (!waiting) return;
		if (saleStatus === "ended" || saleStatus === "sold_out") {
			stop();
			showResult(
				describeError(saleStatus === "ended" ? "sale_ended" : "sold_out"),
			);
		}
	}, [waiting, saleStatus, stop, showResult, describeError]);
}

// The shopper's phase and the requests that move it on. `text` is the sentence under the buttons.
export function useShopper({
	saleId,
	saleStatus,
	client,
	loggedIn,
	onLiveStopped,
	now = Date.now,
	describeError,
}: ShopperOptions) {
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const stopWatching = useRef<() => void>(() => {});

	const stop = useCallback(() => {
		stopWatching.current();
		stopWatching.current = () => {};
	}, []);
	useEffect(() => stop, [stop]);
	useEffect(() => {
		if (loggedIn) return;
		stop();
		setPhase({ kind: "idle" });
	}, [loggedIn, stop]);

	// A result is a sentence the shopper reads and moves on from. Every ending of a request shows one this way.
	const showResult = useCallback(
		(text: string) => setPhase({ kind: "result", text }),
		[],
	);
	const { clock, setClock } = useCountdown(phase, now, showResult);

	useLineEnd(
		phase.kind === "waiting",
		saleStatus,
		stop,
		showResult,
		describeError,
	);

	const fail = ({ errorCode, retryAfterSeconds }: ApiFailure) =>
		showResult(describeError(errorCode, retryAfterSeconds));

	// Shows an item held for the shopper. The countdown starts from this moment, not from the last tick.
	const enterHolding = (reservationId: string, expiresAt: string) => {
		setClock(now());
		setPhase(holdingPhase(reservationId, expiresAt));
	};

	const showBusy = (action: Action, text: string) =>
		setPhase({ kind: "busy", action, text });

	const reserve = async (id: string, ticket: string) => {
		showBusy("buy", TEXT.reserving);
		const reserved = await client.reserve(id, ticket);
		if (reserved.isErr()) return fail(reserved.error);
		enterHolding(reserved.value.reservationId, reserved.value.expiresAt);
	};

	// Follows the place in the line. The line either admits the shopper, which takes the hold, or loses them.
	const onPlace = (ticket: string, place: Place) => {
		if (place.state === "waiting") {
			setPhase({ kind: "waiting", place: place.place });
			return;
		}
		stop();
		if (place.state === "admitted") void reserve(saleId, ticket);
		else showResult(TEXT.placeLost);
	};

	const buy = async () => {
		stop();
		showBusy("buy", TEXT.joining);
		const joined = await client.join(saleId);
		if (joined.isErr()) return fail(joined.error);
		const { ticket } = joined.value;
		if (joined.value.state === "admitted") return reserve(saleId, ticket);
		onPlace(ticket, joined.value);
		stopWatching.current = client.watchPlace(
			saleId,
			ticket,
			(place) => onPlace(ticket, place),
			onLiveStopped,
		);
	};

	const confirm = async () => {
		if (phase.kind !== "holding") return;
		const held = phase;
		showBusy("confirm", TEXT.paying);
		const confirmed = await client.confirm(saleId, held.reservationId);
		if (confirmed.isOk()) return setPhase({ kind: "purchased" });
		// A failed payment keeps the item held, so the shopper can try the payment again.
		if (confirmed.error.errorCode === "payment_failed") {
			return setPhase({ ...held, notice: TEXT.paymentFailed });
		}
		fail(confirmed.error);
	};

	const check = async () => {
		stop();
		showBusy("check", TEXT.checking);
		const outcome = await client.outcome(saleId);
		if (outcome.isErr()) return fail(outcome.error);
		const found = outcome.value;
		if (found.state === "purchased") return setPhase({ kind: "purchased" });
		if (found.state === "holding") {
			return enterHolding(found.reservationId, found.expiresAt);
		}
		showResult(TEXT.nothing);
	};

	return {
		phase,
		text: phaseText(phase, secondsLeft(phase, clock)),
		buy,
		confirm,
		check,
	};
}
