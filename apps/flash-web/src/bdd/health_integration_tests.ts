import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, beforeAll, expect } from "vitest";
import { Route } from "../routes/api/health";
import { specFile } from "./support/paths";

// The route's own handler answers on a loopback port, so the scenario goes over real HTTP.
let server: Server;
let url = "";

beforeAll(async () => {
	const handlers = Route.options.server?.handlers as {
		GET: () => Response | Promise<Response>;
	};
	server = createServer(async (_request, response) => {
		const reply = await handlers.GET();
		response.writeHead(reply.status, Object.fromEntries(reply.headers));
		response.end(await reply.text());
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/health/liveness.feature")),
	({ Scenario }) => {
		Scenario("Web liveness returns ok", ({ When, Then, And }) => {
			let response: Response;

			When("a client sends GET /api/health", async () => {
				response = await fetch(`${url}/api/health`);
			});

			Then("the response status is 200", () => {
				expect(response.status).toBe(200);
			});

			And('the body has status "ok"', async () => {
				expect(await response.json()).toEqual({ status: "ok" });
			});
		});
	},
);
