import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleClient } from "./client";
import { useShopper } from "./use-shopper";

describe("useShopper", () => {
	it("does not confirm when nothing is held", async () => {
		const confirm = vi.fn();
		const client = { confirm } as unknown as SaleClient;
		const { result } = renderHook(() => useShopper("sale-1", "active", client));
		await act(async () => result.current.confirm());
		expect(confirm).not.toHaveBeenCalled();
		expect(result.current.phase).toEqual({ kind: "idle" });
		expect(result.current.text).toBe("");
	});
});
