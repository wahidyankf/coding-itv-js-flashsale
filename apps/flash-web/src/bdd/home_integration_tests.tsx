import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect } from "vitest";
import { loadBackendStatus } from "../backend";
import { HomePage } from "../routes/index";
import { specFile } from "./support/paths";

// A stub stands in for flash-be on a loopback port, so these scenarios need no running backend.
// Each scenario sets the reply the stub gives, and the address the web app is pointed at.
let reply = { status: 200, body: JSON.stringify({ status: "ok" }) };
let stubUrl = "";
let target = "";
let server: Server;

beforeAll(async () => {
	server = createServer((_request, response) => {
		response.writeHead(reply.status, { "content-type": "application/json" });
		response.end(reply.body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	stubUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

// Renders the home page the way a visitor's request would: the status comes over real HTTP.
async function renderHomePage(): Promise<string> {
	const status = await loadBackendStatus({ FLASH_BE_URL: target });
	return renderToStaticMarkup(<HomePage status={status} />);
}

describeFeature(
	await loadFeature(
		specFile("flash/web/behaviours/home/backend-status.feature"),
	),
	({ Scenario }) => {
		Scenario(
			"Home shows the backend as ok when flash-be is live",
			({ Given, When, Then, And }) => {
				let html = "";

				Given('flash-be reports status "ok"', () => {
					reply = { status: 200, body: JSON.stringify({ status: "ok" }) };
					target = stubUrl;
				});

				When("a visitor opens the home page", async () => {
					html = await renderHomePage();
				});

				Then('the page heading is "Flash Sale"', () => {
					expect(html).toContain("<h1>Flash Sale</h1>");
				});

				And('the page says "Backend: ok"', () => {
					expect(html).toContain("Backend: <strong>ok</strong>");
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be is unreachable",
			({ Given, When, Then }) => {
				let html = "";

				Given("flash-be cannot be reached", () => {
					// Port 1 has no listener, so the request is refused at once.
					target = "http://127.0.0.1:1";
				});

				When("a visitor opens the home page", async () => {
					html = await renderHomePage();
				});

				Then('the page says "Backend: down"', () => {
					expect(html).toContain("Backend: <strong>down</strong>");
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be answers with an error",
			({ Given, When, Then }) => {
				let html = "";

				Given("flash-be answers /health with status 500", () => {
					reply = { status: 500, body: "nope" };
					target = stubUrl;
				});

				When("a visitor opens the home page", async () => {
					html = await renderHomePage();
				});

				Then('the page says "Backend: down"', () => {
					expect(html).toContain("Backend: <strong>down</strong>");
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be reports another status",
			({ Given, When, Then }) => {
				let html = "";

				Given('flash-be reports status "starting"', () => {
					reply = { status: 200, body: JSON.stringify({ status: "starting" }) };
					target = stubUrl;
				});

				When("a visitor opens the home page", async () => {
					html = await renderHomePage();
				});

				Then('the page says "Backend: down"', () => {
					expect(html).toContain("Backend: <strong>down</strong>");
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
