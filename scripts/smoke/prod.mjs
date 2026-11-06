// Starts the production stack (compose.prod.yaml) under its own project name, with random secrets and free ports, and
// walks one shopper through it: an operator creates a sale through the API, the shopper joins, holds an item, pays and
// asks if they got it, all through the web server. Then the stack and its volumes are removed.
// Usage: npm run smoke:prod   (needs Docker; builds the images, so the first run takes a few minutes)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { createClient, routes, TICKET_HEADER } from "@flash/contract";

const root = path.resolve(import.meta.dirname, "../..");
const PROJECT = "flash-smoke";
const MINUTE_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

const secret = () => randomBytes(24).toString("hex");

const bePort = await freePort();
const webPort = await freePort();
const adminToken = secret();
const env = {
	...process.env,
	POSTGRES_USER: "flash",
	POSTGRES_PASSWORD: secret(),
	POSTGRES_DB: "flash",
	TICKET_SECRET: secret(),
	ADMIN_TOKEN: adminToken,
	FLASH_BE_PORT: String(bePort),
	FLASH_WEB_PORT: String(webPort),
};

function compose(...words) {
	return execFileSync(
		"docker",
		["compose", "-p", PROJECT, "-f", "compose.prod.yaml", ...words],
		{ cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
	);
}

function step(label) {
	console.log(`- ${label}`);
}

// A reply that is not the one expected stops the walk, with what came back.
function expectOk(label, result, status) {
	if (result.isErr()) {
		throw new Error(`${label}: refused with ${JSON.stringify(result.error)}`);
	}
	if (status !== undefined && result.value.status !== status) {
		throw new Error(
			`${label}: status ${result.value.status}, wanted ${status}`,
		);
	}
	return result.value.body;
}

function expectRefusal(label, result, error) {
	if (result.isOk() || result.error.error !== error) {
		throw new Error(
			`${label}: wanted ${error}, got ${JSON.stringify(result.isOk() ? result.value : result.error)}`,
		);
	}
}

async function walk() {
	step(`building and starting the stack (api on ${bePort}, web on ${webPort})`);
	compose("up", "-d", "--build", "--wait");

	step("three API instances are healthy behind nginx");
	const running = JSON.parse(
		`[${compose("ps", "--format", "json").trim().split("\n").join(",")}]`,
	)
		.filter((container) => /flash-be-[123]$/.test(container.Service))
		.filter((container) => container.Health === "healthy");
	if (running.length !== 3) {
		throw new Error(`wanted 3 healthy API instances, found ${running.length}`);
	}

	const api = createClient({ baseUrl: `http://127.0.0.1:${bePort}` });
	const web = createClient({ baseUrl: `http://127.0.0.1:${webPort}/api` });

	step("the API is ready");
	const ready = await fetch(`http://127.0.0.1:${bePort}/ready`);
	if (ready.status !== 200) throw new Error(`/ready answered ${ready.status}`);

	step("an operator with a wrong token is refused");
	const body = {
		stock: 2,
		holdSeconds: 60,
		startsAt: new Date(Date.now() - MINUTE_MS).toISOString(),
		endsAt: new Date(Date.now() + 60 * MINUTE_MS).toISOString(),
	};
	expectRefusal(
		"wrong token",
		await api.call(routes.createSale, {
			headers: { authorization: "Bearer not-the-token-at-all" },
			body,
		}),
		"invalid_admin_token",
	);

	step("an operator creates a sale through the API");
	const sale = expectOk(
		"create sale",
		await api.call(routes.createSale, {
			headers: { authorization: `Bearer ${adminToken}` },
			body,
		}),
		201,
	);

	step("the web server does not pass the admin route on");
	const blocked = await fetch(`http://127.0.0.1:${webPort}/api/admin/sales`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	if (blocked.status !== 404) {
		throw new Error(`the web server answered ${blocked.status} to /api/admin`);
	}

	step("the shopper sees the sale through the web server");
	const current = expectOk(
		"current sale",
		await web.call(routes.currentSale, {}),
		200,
	);
	if (current.id !== sale.id)
		throw new Error("the current sale is not the new one");

	step("the shopper joins the queue and is admitted");
	const params = { saleId: sale.id };
	const joined = expectOk(
		"join",
		await web.call(routes.joinQueue, { params, body: { userId: "smoke" } }),
	);
	const headers = { [TICKET_HEADER]: joined.ticket };
	let state = joined.state;
	for (let tries = 0; state !== "admitted" && tries < 30; tries++) {
		await sleep(500);
		const place = expectOk(
			"place",
			await web.call(routes.checkPlace, {
				params: { ...params, userId: "smoke" },
				headers,
			}),
			200,
		);
		state = place.state;
	}
	if (state !== "admitted") throw new Error("the shopper was never admitted");

	step("the shopper holds one item");
	const held = expectOk(
		"reserve",
		await web.call(routes.reserve, {
			params,
			headers,
			body: { userId: "smoke" },
		}),
	);

	step("the shopper pays (a declined charge is tried again)");
	let purchase;
	for (let attempt = 0; purchase === undefined && attempt < 5; attempt++) {
		const paid = await web.call(routes.confirm, {
			params,
			body: { userId: "smoke", reservationId: held.reservationId },
		});
		if (paid.isOk()) purchase = paid.value.body;
		else if (paid.error.error !== "payment_failed") {
			throw new Error(`confirm: ${JSON.stringify(paid.error)}`);
		}
	}
	if (purchase === undefined)
		throw new Error("the payment was declined every time");

	step("the shopper asks if they got it, and cannot buy twice");
	const outcome = expectOk(
		"outcome",
		await web.call(routes.outcome, { params: { ...params, userId: "smoke" } }),
		200,
	);
	if (outcome.state !== "purchased") {
		throw new Error(`the outcome is ${outcome.state}, wanted purchased`);
	}
	expectRefusal(
		"second reserve",
		await web.call(routes.reserve, {
			params,
			headers,
			body: { userId: "smoke" },
		}),
		"already_purchased",
	);
}

try {
	await walk();
} finally {
	console.log("- removing the stack and its volumes");
	compose("down", "-v", "--remove-orphans");
}
console.log("smoke:prod passed");
