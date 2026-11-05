import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchBackendHealth } from "./backend";

// Stub flash-be on a random port, so the test does not need the real backend running.
describe("fetchBackendHealth over real HTTP", () => {
	let server: Server;
	let baseUrl: string;

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url === "/health") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ status: "ok" }));
				return;
			}
			response.writeHead(404).end();
		});

		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	});

	it("reports ok when the backend answers /health", async () => {
		expect(await fetchBackendHealth(baseUrl)).toBe("ok");
	});

	it("reports down when nothing listens on the port", async () => {
		expect(await fetchBackendHealth("http://127.0.0.1:1")).toBe("down");
	});
});
