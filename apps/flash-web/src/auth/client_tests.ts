import { Err, Ok } from "@flash/typekit";
import { describe, expect, it, vi } from "vitest";
import { createAuthClient } from "./client";

const ANA = { username: "ana", role: "shopper" };

function client(reply: () => Response) {
	const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => reply());
	return {
		fetcher,
		api: createAuthClient("http://web.test", fetcher as typeof fetch),
	};
}

describe("createAuthClient", () => {
	it("asks who is logged in, with no body", async () => {
		const { api, fetcher } = client(() => Response.json(ANA));
		expect(await api.me()).toEqual(new Ok(ANA));
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe("http://web.test/api/auth/me");
		expect(init?.body).toBeUndefined();
	});

	it.each([
		["register", "/api/auth/register"],
		["login", "/api/auth/login"],
	] as const)("sends the name and the password to %s", async (call, path) => {
		const { api, fetcher } = client(() => Response.json(ANA, { status: 201 }));
		expect(await api[call]("ana", "a long password")).toEqual(new Ok(ANA));
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`http://web.test${path}`);
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe('{"username":"ana","password":"a long password"}');
	});

	it("posts an empty body to log out", async () => {
		const { api, fetcher } = client(() => Response.json({}));
		expect(await api.logout()).toEqual(new Ok({}));
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe("http://web.test/api/auth/logout");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe("{}");
	});

	it("gives the code of a refusal", async () => {
		const { api } = client(() =>
			Response.json(
				{ errorCode: "invalid_credentials", errorMessage: "no" },
				{ status: 401 },
			),
		);
		expect(await api.login("ana", "wrong password")).toEqual(
			new Err({
				errorCode: "invalid_credentials",
				errorMessage: "no",
				retryAfterSeconds: undefined,
			}),
		);
	});

	it("works with the defaults", () => {
		expect(typeof createAuthClient().me).toBe("function");
	});
});
