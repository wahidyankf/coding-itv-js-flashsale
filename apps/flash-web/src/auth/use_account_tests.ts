import { Err, Ok } from "@flash/typekit";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthClient } from "./client";
import type { Account } from "./types";
import { useAccount } from "./use-account";

const ANA: Account = { username: "ana", role: "shopper" };
const none = () => () => {};

function client(overrides: Partial<AuthClient> = {}): AuthClient {
	return {
		me: vi.fn(async () => new Ok(ANA)),
		register: vi.fn(async () => new Ok(ANA)),
		login: vi.fn(async () => new Ok(ANA)),
		logout: vi.fn(async () => new Ok({})),
		...overrides,
	};
}

describe("useAccount", () => {
	it("starts by checking, then knows the shopper", async () => {
		const auth = client();
		const { result } = renderHook(() => useAccount(auth, none));
		expect(result.current.state).toEqual({ kind: "checking" });
		await act(async () => {});
		expect(result.current.state).toEqual({ kind: "in", account: ANA });
	});

	it("tells how long to wait when the server limits the attempts", async () => {
		const auth = client({
			me: async () =>
				new Err({ errorCode: "not_authenticated", errorMessage: "" }),
			login: async () =>
				new Err({
					errorCode: "rate_limited",
					errorMessage: "",
					retryAfterSeconds: 12,
				}),
		});
		const { result } = renderHook(() => useAccount(auth, none));
		await act(async () => {});
		let problem: string | undefined;
		await act(async () => {
			problem = await result.current.enter("login", "ana", "a long password");
		});
		expect(problem).toBe("Too many requests. Try again in 12 seconds.");
		expect(result.current.state).toEqual({ kind: "anonymous" });
	});

	it("stops listening for an expired login when the page is left", async () => {
		const stop = vi.fn();
		const auth = client();
		const listen = () => stop;
		const { unmount } = renderHook(() => useAccount(auth, listen));
		await act(async () => {});
		unmount();
		expect(stop).toHaveBeenCalledOnce();
	});
});
