import { Ok } from "@flash/typekit";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleClient } from "./client";
import { useShopper } from "./use-shopper";

describe("useShopper", () => {
	it("does not confirm when nothing is held", async () => {
		const confirm = vi.fn();
		const client = { confirm } as unknown as SaleClient;
		const { result } = renderHook(() =>
			useShopper("sale-1", "active", client, true),
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
			({ loggedIn }) => useShopper("sale-1", "active", client, loggedIn),
			{ initialProps: { loggedIn: true } },
		);
		await act(async () => result.current.buy());
		expect(result.current.phase).toEqual({ kind: "waiting", place: 3 });
		rerender({ loggedIn: false });
		expect(stop).toHaveBeenCalledOnce();
		expect(result.current.phase).toEqual({ kind: "idle" });
	});
});
