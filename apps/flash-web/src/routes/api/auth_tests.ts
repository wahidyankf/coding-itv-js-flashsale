import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./auth.$";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("the /api/auth route", () => {
	it("passes GET and POST to flash-be, at the address in the environment", async () => {
		vi.stubEnv("FLASH_BE_URL", "http://flash-be.test");
		const urls: string[] = [];
		vi.stubGlobal("fetch", async (input: unknown) => {
			urls.push(String(input));
			return Response.json({ username: "ana", role: "shopper" });
		});
		const handlers = Route.options.server?.handlers as unknown as Record<
			string,
			(context: { request: Request }) => Promise<Response>
		>;
		const get = await handlers.GET?.({
			request: new Request("http://web.test/api/auth/me"),
		});
		const post = await handlers.POST?.({
			request: new Request("http://web.test/api/auth/login", {
				method: "POST",
				body: "{}",
			}),
		});
		expect(get?.status).toBe(200);
		expect(post?.status).toBe(200);
		expect(urls).toEqual([
			"http://flash-be.test/auth/me",
			"http://flash-be.test/auth/login",
		]);
	});
});
