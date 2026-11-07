import { useCallback, useEffect, useRef, useState } from "react";
import { MS_PER_SECOND } from "../api";
import type { SaleClient } from "./client";
import { errorText, holdingText, TEXT, waitingText } from "./messages";
import type { ApiFailure, Place, SaleStatus } from "./types";

// What the shopper asked for, so the page can show the spinner on the button that was pressed.
export type Action = "buy" | "check" | "confirm";

// Where the shopper is. `busy` is a request in flight; `message` is a result the shopper reads and moves on from.
export type Phase =
	| { kind: "idle" }
	| { kind: "busy"; action: Action; text: string }
	| { kind: "waiting"; place: number }
	| {
			kind: "holding";
			reservationId: string;
			expiresAt: number;
			notice?: string;
	  }
	| { kind: "purchased" }
	| { kind: "message"; text: string };

const COUNTDOWN_MS = 250;

export function useShopper(
	saleId: string,
	saleStatus: SaleStatus,
	client: SaleClient,
	// Only a shopper who is logged in can buy. When the login goes, whatever the shopper was doing stops.
	loggedIn: boolean,
	now: () => number = Date.now,
) {
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [clock, setClock] = useState(now());
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

	// The countdown ticks only while an item is held.
	const holding = phase.kind === "holding";
	useEffect(() => {
		if (!holding) return;
		const timer = setInterval(() => setClock(now()), COUNTDOWN_MS);
		return () => clearInterval(timer);
	}, [holding, now]);

	const secondsLeft =
		phase.kind === "holding"
			? Math.max(0, Math.ceil((phase.expiresAt - clock) / MS_PER_SECOND))
			: 0;
	useEffect(() => {
		if (phase.kind === "holding" && phase.expiresAt <= clock) {
			setPhase({ kind: "message", text: TEXT.holdEnded });
		}
	}, [phase, clock]);

	// The line stops moving when the sale ends or sells out, so a waiting shopper is told instead of kept waiting.
	const waiting = phase.kind === "waiting";
	useEffect(() => {
		if (!waiting) return;
		if (saleStatus === "ended" || saleStatus === "sold_out") {
			stop();
			setPhase({
				kind: "message",
				text: errorText(saleStatus === "ended" ? "sale_ended" : "sold_out"),
			});
		}
	}, [waiting, saleStatus, stop]);

	const fail = ({ errorCode, retryAfterSeconds }: ApiFailure) =>
		setPhase({
			kind: "message",
			text: errorText(errorCode, retryAfterSeconds),
		});

	const reserve = async (id: string, ticket: string) => {
		setPhase({ kind: "busy", action: "buy", text: TEXT.reserving });
		const reserved = await client.reserve(id, ticket);
		if (reserved.isErr()) return fail(reserved.error);
		const expiresAt = Date.parse(reserved.value.expiresAt);
		setClock(now());
		setPhase({
			kind: "holding",
			reservationId: reserved.value.reservationId,
			expiresAt,
		});
	};

	const buy = async () => {
		stop();
		setPhase({ kind: "busy", action: "buy", text: TEXT.joining });
		const joined = await client.join(saleId);
		if (joined.isErr()) return fail(joined.error);

		const { ticket } = joined.value;
		if (joined.value.state === "admitted") return reserve(saleId, ticket);

		const onPlace = (place: Place) => {
			if (place.state === "waiting") {
				setPhase({ kind: "waiting", place: place.place });
			} else if (place.state === "admitted") {
				stop();
				void reserve(saleId, ticket);
			} else {
				stop();
				setPhase({ kind: "message", text: TEXT.placeLost });
			}
		};
		onPlace(joined.value);
		stopWatching.current = client.watchPlace(saleId, ticket, onPlace);
	};

	const confirm = async () => {
		if (phase.kind !== "holding") return;
		const held = phase;
		setPhase({ kind: "busy", action: "confirm", text: TEXT.paying });
		const confirmed = await client.confirm(saleId, held.reservationId);
		if (confirmed.isOk()) return setPhase({ kind: "purchased" });
		if (confirmed.error.errorCode === "payment_failed") {
			return setPhase({ ...held, notice: TEXT.paymentFailed });
		}
		fail(confirmed.error);
	};

	const check = async () => {
		stop();
		setPhase({ kind: "busy", action: "check", text: TEXT.checking });
		const outcome = await client.outcome(saleId);
		if (outcome.isErr()) return fail(outcome.error);
		const found = outcome.value;
		if (found.state === "purchased") return setPhase({ kind: "purchased" });
		if (found.state === "holding") {
			setClock(now());
			return setPhase({
				kind: "holding",
				reservationId: found.reservationId,
				expiresAt: Date.parse(found.expiresAt),
			});
		}
		setPhase({ kind: "message", text: TEXT.nothing });
	};

	// The sentence under the buttons.
	const text = (() => {
		switch (phase.kind) {
			case "idle":
				return "";
			case "busy":
				return phase.text;
			case "waiting":
				return waitingText(phase.place);
			case "holding":
				return phase.notice ?? holdingText(secondsLeft);
			case "purchased":
				return TEXT.purchased;
			case "message":
				return phase.text;
		}
	})();

	return { phase, text, buy, confirm, check };
}
