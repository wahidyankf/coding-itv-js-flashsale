// Unit tests for the shopper hook: what it does when there is nothing to confirm, when the login goes, and which purchase
// id it keeps once a purchase is confirmed or found.
import { Err, Ok } from "@flash/typekit";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleClient } from "./client";
import { useShopper } from "./use-shopper";

// The sentence the page gives for a code. The real sentences are tested in error_text_tests.ts; this hook only shows what it
// is given.
const describeError = (code: string) => `the page says ${code}`;
// A fixed clock, before the hold's expiry, so the countdown does not end the hold during a test.
const NOW = Date.parse("2026-06-01T12:00:00Z");
const EXPIRES = "2026-06-01T12:02:00Z";

describe("useShopper", () => {
	it("does not confirm when nothing is held", async () => {
		const confirm = vi.fn();
		const client = { confirm } as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper({
				saleId: "sale-1",
				saleStatus: "active",
				client,
				loggedIn: true,
				onLiveStopped: () => {},
				describeError,
			}),
		);
		await act(async () => result.current.confirm());
		expect(confirm).not.toHaveBeenCalled();
		expect(result.current.phase).toEqual({ kind: "idle" });
		expect(result.current.text).toBe("");
	});

	it("stops what the shopper was doing when the login goes", async () => {
		const stop = vi.fn();
		const client = {
			join: vi.fn(
				async () =>
					new Ok({ userId: "ana", ticket: "t1", state: "waiting", place: 3 }),
			),
			watchPlace: vi.fn(() => stop),
		} as unknown as SaleClient;
		const { result, rerender } = renderHook(
			({ loggedIn }) =>
				useShopper({
					saleId: "sale-1",
					saleStatus: "active",
					client,
					loggedIn,
					onLiveStopped: () => {},
					describeError,
				}),
			{ initialProps: { loggedIn: true } },
		);
		await act(async () => result.current.buy());
		expect(result.current.phase).toEqual({ kind: "waiting", place: 3 });
		rerender({ loggedIn: false });
		expect(stop).toHaveBeenCalledOnce();
		expect(result.current.phase).toEqual({ kind: "idle" });
	});

	it("shows the sentence it is given when the API refuses a request", async () => {
		const client = {
			join: vi.fn(
				async () => new Err({ errorCode: "sold_out", errorMessage: "" }),
			),
		} as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper({
				saleId: "sale-1",
				saleStatus: "active",
				client,
				loggedIn: true,
				onLiveStopped: () => {},
				describeError,
			}),
		);
		await act(async () => result.current.buy());
		expect(result.current.phase).toEqual({
			kind: "result",
			text: "the page says sold_out",
		});
	});

	it("tells the page when the place stream has given up", async () => {
		const onLiveStopped = vi.fn();
		const client = {
			join: vi.fn(
				async () =>
					new Ok({ userId: "ana", ticket: "t1", state: "waiting", place: 3 }),
			),
			// The fake stream gives up at once, as the watcher does after its last try.
			watchPlace: vi.fn((_saleId, _ticket, _onPlace, onGiveUp: () => void) => {
				onGiveUp();
				return () => {};
			}),
		} as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper({
				saleId: "sale-1",
				saleStatus: "active",
				client,
				loggedIn: true,
				onLiveStopped,
				describeError,
			}),
		);
		await act(async () => result.current.buy());
		expect(onLiveStopped).toHaveBeenCalledOnce();
	});

	it("keeps the id of the purchase the payment confirms", async () => {
		const client = {
			join: vi.fn(
				async () => new Ok({ userId: "ana", ticket: "t1", state: "admitted" }),
			),
			reserve: vi.fn(
				async () =>
					new Ok({ userId: "ana", reservationId: "r1", expiresAt: EXPIRES }),
			),
			confirm: vi.fn(
				async () =>
					new Ok({
						userId: "ana",
						purchaseId: "p1",
						reservationId: "r1",
						purchasedAt: "2026-06-01T12:01:00Z",
					}),
			),
		} as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper({
				saleId: "sale-1",
				saleStatus: "active",
				client,
				loggedIn: true,
				onLiveStopped: () => {},
				now: () => NOW,
				describeError,
			}),
		);
		await act(async () => result.current.buy());
		await act(async () => result.current.confirm());
		expect(result.current.phase).toEqual({
			kind: "purchased",
			purchaseId: "p1",
		});
	});

	it("keeps the id of the purchase a status check finds", async () => {
		const client = {
			outcome: vi.fn(
				async () =>
					new Ok({
						userId: "ana",
						state: "purchased",
						purchaseId: "p1",
						reservationId: "r1",
						purchasedAt: "2026-06-01T12:01:00Z",
					}),
			),
		} as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper({
				saleId: "sale-1",
				saleStatus: "active",
				client,
				loggedIn: true,
				onLiveStopped: () => {},
				describeError,
			}),
		);
		await act(async () => result.current.check());
		expect(result.current.phase).toEqual({
			kind: "purchased",
			purchaseId: "p1",
		});
	});
});
