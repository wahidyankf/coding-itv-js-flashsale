// Integration test for proxy.ts behind srvx's Node adapter, the server the built app runs on (Nitro's node-server). It
// pins the `ip` the server puts on each request: if a new srvx or Nitro stopped setting it, the API would put every
// shopper in one rate-limit bucket.
import { serve } from "srvx/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyToBackend } from "./proxy";

const ENV = { FLASH_BE_URL: "http://flash-be.test" };

const servers: Array<{ close: (force: boolean) => Promise<void> }> = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close(true)));
});

describe("the proxy behind the Node server of the built app", () => {
	it("tells the API the caller's address, which the server puts on the request as ip", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
		const server = serve({
			port: 0,
			hostname: "127.0.0.1",
			silent: true,
			gracefulShutdown: false,
			fetch: (request) => proxyToBackend(request, ENV, fetcher),
		});
		servers.push(server);
		await server.ready();
		const reply = await fetch(new URL("/api/v1/auth/me", server.url), {
			headers: { "x-forwarded-for": "203.0.113.9" },
		});
		expect(reply.status).toBe(200);
		const sent = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
		expect(sent.get("x-forwarded-for")).toBe("127.0.0.1");
	});
});
