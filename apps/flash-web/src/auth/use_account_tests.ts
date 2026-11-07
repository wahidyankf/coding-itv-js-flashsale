// Unit tests for the account hook: the first check, a failed log in or sign up, and a log out.
import { Err, Ok } from "@flash/typekit";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthClient } from "./client";
import type { Account } from "./types";
import { useAccount } from "./use-account";

const ANA: Account = { username: "ana", role: "shopper" };
const none = () => () => {};
// The sentence the page gives for a code. The real sentences are tested in error_text_tests.ts; this hook only shows what it
// is given.
const describeError = (code: string, seconds?: number) =>
	seconds === undefined ? code : `${code} in ${seconds}s`;

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
		const { result } = renderHook(() => useAccount(auth, none, describeError));
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
		const { result } = renderHook(() => useAccount(auth, none, describeError));
		await act(async () => {});
		let problem: string | undefined;
		await act(async () => {
			problem = await result.current.enter("login", "ana", "a long password");
		});
		expect(problem).toBe("rate_limited in 12s");
		expect(result.current.state).toEqual({ kind: "anonymous" });
	});

	it("shows the sentence it is given for a refused log in, and no sentence of its own", async () => {
		const auth = client({
			me: async () =>
				new Err({ errorCode: "not_authenticated", errorMessage: "" }),
			login: async () =>
				new Err({ errorCode: "invalid_credentials", errorMessage: "" }),
		});
		const { result } = renderHook(() =>
			useAccount(auth, none, (code) => `the page says ${code}`),
		);
		await act(async () => {});
		let problem: string | undefined;
		await act(async () => {
			problem = await result.current.enter("login", "ana", "a long password");
		});
		expect(problem).toBe("the page says invalid_credentials");
	});

	it("stops listening for an expired login when the page is left", async () => {
		const stop = vi.fn();
		const auth = client();
		const listen = () => stop;
		const { unmount } = renderHook(() =>
			useAccount(auth, listen, describeError),
		);
		await act(async () => {});
		unmount();
		expect(stop).toHaveBeenCalledOnce();
	});
});
