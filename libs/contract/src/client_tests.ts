import { describe, expect, it } from "vitest";
import { createClient, type Fetch } from "./client.js";
import { routes } from "./routes.js";
import {
	CLIENT_FAILURE_MESSAGE,
	ERROR_MESSAGE,
	errorPayload,
} from "./vocabulary.js";

const answer = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) =>
	({
		status,
		headers: {
			forEach: (visit: (value: string, name: string) => void) => {
				for (const [name, value] of Object.entries(headers)) visit(value, name);
			},
		},
		text: async () => JSON.stringify(body),
	}) satisfies Awaited<ReturnType<Fetch>>;

describe("createClient", () => {
	it("sends the built request and reads the reply", async () => {
		const seen: Array<{ url: string; init: unknown }> = [];
		const client = createClient({
			baseUrl: "http://api",
			fetch: async (url, init) => {
				seen.push({ url, init });
				return answer(201, { userId: "ana", ticket: "t", state: "admitted" });
			},
		});
		const result = await client.call(routes.joinQueue, {
			params: { saleId: "s1" },
			body: { userId: "ana" },
		});
		expect(result.isOk() && result.value.status).toBe(201);
		expect(seen).toEqual([
			{
				url: "http://api/sales/s1/queue",
				init: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: '{"userId":"ana"}',
				},
			},
		]);
	});

	it("sends a read without a body", async () => {
		const client = createClient({
			baseUrl: "",
			fetch: async (_url, init) => {
				expect(init).toEqual({ method: "GET", headers: {} });
				return answer(200, { status: "ok" });
			},
		});
		expect((await client.call(routes.health, {})).isOk()).toBe(true);
	});

	it("passes the headers of the reply on", async () => {
		const client = createClient({
			baseUrl: "",
			fetch: async () =>
				answer(
					429,
					{ ...errorPayload("rate_limited"), retryAfterSeconds: 9 },
					{ "retry-after": "2" },
				),
		});
		const result = await client.call(routes.joinQueue, {
			params: { saleId: "s1" },
			body: { userId: "ana" },
		});
		expect(result.isErr() && result.error).toMatchObject({
			errorCode: "rate_limited",
			errorMessage: ERROR_MESSAGE.rate_limited,
			retryAfterSeconds: 2,
		});
	});

	it("turns a failed fetch into a network failure", async () => {
		const client = createClient({
			baseUrl: "",
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const result = await client.call(routes.health, {});
		expect(result.isErr() && result.error).toEqual({
			errorCode: "network",
			errorMessage: CLIENT_FAILURE_MESSAGE.network,
		});
	});

	it("uses the global fetch when none is given", async () => {
		const client = createClient({ baseUrl: "http://127.0.0.1:1" });
		const result = await client.call(routes.health, {});
		expect(result.isErr() && result.error.errorCode).toBe("network");
	});
});
