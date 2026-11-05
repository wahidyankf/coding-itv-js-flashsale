import { useCallback, useEffect, useRef, useState } from "react";
import type { SaleClient } from "./client";
import {
	cleanUser,
	errorText,
	holdingText,
	TEXT,
	waitingText,
} from "./messages";
import type { ApiError, Place, SaleStatus } from "./types";

// Where the shopper is. `busy` is a request in flight; `message` is a result the shopper reads and moves on from.
export type Phase =
	| { kind: "idle" }
	| { kind: "busy"; text: string }
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
	now: () => number = Date.now,
) {
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [clock, setClock] = useState(now());
	const user = useRef("");
	const stopWatching = useRef<() => void>(() => {});

	const stop = useCallback(() => {
		stopWatching.current();
		stopWatching.current = () => {};
	}, []);
	useEffect(() => stop, [stop]);

	// The countdown ticks only while an item is held.
	const holding = phase.kind === "holding";
	useEffect(() => {
		if (!holding) return;
		const timer = setInterval(() => setClock(now()), COUNTDOWN_MS);
		return () => clearInterval(timer);
	}, [holding, now]);

	const secondsLeft =
		phase.kind === "holding"
			? Math.max(0, Math.ceil((phase.expiresAt - clock) / 1000))
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

	const fail = ({ error, retryAfterSeconds }: ApiError) =>
		setPhase({ kind: "message", text: errorText(error, retryAfterSeconds) });

	const reserve = async (id: string, name: string, ticket: string) => {
		setPhase({ kind: "busy", text: TEXT.reserving });
		const reserved = await client.reserve(id, name, ticket);
		if (reserved.isErr()) return fail(reserved.error);
		const expiresAt = Date.parse(reserved.value.expiresAt);
		setClock(now());
		setPhase({
			kind: "holding",
			reservationId: reserved.value.reservationId,
			expiresAt,
		});
	};

	const buy = async (raw: string) => {
		const cleaned = cleanUser(raw);
		if (!cleaned) return setPhase({ kind: "message", text: TEXT.invalidUser });
		const name = cleaned.value;
		stop();
		user.current = name;
		setPhase({ kind: "busy", text: TEXT.joining });
		const joined = await client.join(saleId, name);
		if (joined.isErr()) return fail(joined.error);

		const { ticket } = joined.value;
		if (joined.value.state === "admitted") return reserve(saleId, name, ticket);

		const onPlace = (place: Place) => {
			if (place.state === "waiting") {
				setPhase({ kind: "waiting", place: place.place });
			} else if (place.state === "admitted") {
				stop();
				void reserve(saleId, name, ticket);
			} else {
				stop();
				setPhase({ kind: "message", text: TEXT.placeLost });
			}
		};
		onPlace(joined.value);
		stopWatching.current = client.watchPlace(saleId, name, ticket, onPlace);
	};

	const confirm = async () => {
		if (phase.kind !== "holding") return;
		const held = phase;
		setPhase({ kind: "busy", text: TEXT.paying });
		const confirmed = await client.confirm(
			saleId,
			user.current,
			held.reservationId,
		);
		if (confirmed.isOk()) return setPhase({ kind: "purchased" });
		if (confirmed.error.error === "payment_failed") {
			return setPhase({ ...held, notice: TEXT.paymentFailed });
		}
		fail(confirmed.error);
	};

	const check = async (raw: string) => {
		const cleaned = cleanUser(raw);
		if (!cleaned) return setPhase({ kind: "message", text: TEXT.invalidUser });
		const name = cleaned.value;
		stop();
		user.current = name;
		setPhase({ kind: "busy", text: TEXT.checking });
		const outcome = await client.outcome(saleId, name);
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
