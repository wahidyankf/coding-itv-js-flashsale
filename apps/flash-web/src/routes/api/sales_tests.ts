import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./sales.$";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("the /api/sales route", () => {
	it("passes GET and POST to flash-be, at the address in the environment", async () => {
		vi.stubEnv("FLASH_BE_URL", "http://flash-be.test");
		const urls: string[] = [];
		vi.stubGlobal("fetch", async (input: unknown) => {
			urls.push(String(input));
			return Response.json({ ok: true });
		});
		const handlers = Route.options.server?.handlers as unknown as Record<
			string,
			(context: { request: Request }) => Promise<Response>
		>;
		const get = await handlers.GET?.({
			request: new Request("http://web.test/api/sales/current"),
		});
		const post = await handlers.POST?.({
			request: new Request(
				"http://web.test/api/sales/11111111-1111-4111-8111-111111111111/queue",
				{ method: "POST", body: "{}" },
			),
		});
		expect(get?.status).toBe(200);
		expect(post?.status).toBe(200);
		expect(urls[0]).toBe("http://flash-be.test/sales/current");
		expect(urls[1]).toBe(
			"http://flash-be.test/sales/11111111-1111-4111-8111-111111111111/queue",
		);
	});
});
