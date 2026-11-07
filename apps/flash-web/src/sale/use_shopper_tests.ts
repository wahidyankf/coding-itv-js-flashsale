// Unit tests for the shopper hook: what it does when there is nothing to confirm, and when the login goes.
import { Err, Ok } from "@flash/typekit";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleClient } from "./client";
import { useShopper } from "./use-shopper";

// The sentence the page gives for a code. The real sentences are tested in error_text_tests.ts; this hook only shows what it
// is given.
const describeError = (code: string) => `the page says ${code}`;

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
});
