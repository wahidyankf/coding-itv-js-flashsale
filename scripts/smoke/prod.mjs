// Smoke test of the production stack (compose.prod.yaml), under its own project name, with random secrets and free ports.
// An operator, made with the create-operator command, makes a sale through the API. A shopper then buys through the web server.
// At the end the stack and its volumes are removed.
// Usage: npm run smoke:prod   (needs Docker; builds the images, so the first run takes a few minutes)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const PROJECT = "flash-smoke";
// The API instances in compose.prod.yaml. The run waits for all of them to be healthy.
const API_INSTANCES = ["flash-be-1", "flash-be-2", "flash-be-3"];
// The shopper checks the queue this often, this many times, before the run gives up.
const ADMISSION_CHECK_MS = 500;
const MAX_ADMISSION_CHECKS = 30;
// A declined payment is tried up to this many times in total.
const MAX_PAYMENT_ATTEMPTS = 5;
const MINUTE_MS = 60_000;
const TICKET_HEADER = "x-queue-ticket";
const STATUS = { ok: 200, created: 201, firstError: 400, notFound: 404 };

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
const origin = `http://127.0.0.1:${webPort}`;
// The operator the walk logs in as, and the password of every account of the walk.
const OPERATOR = "smoke-operator";
const SHOPPER = "smoke";
const password = secret();
const env = {
	...process.env,
	POSTGRES_USER: "flash",
	POSTGRES_PASSWORD: secret(),
	POSTGRES_DB: "flash",
	TICKET_SECRET: secret(),
	// The walk talks plain HTTP to the stack, which cannot carry Secure cookies.
	COOKIE_SECURE: "false",
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

// One request to the API or to the web server. A refusal is `{ errorCode, errorMessage }` with a status of 400 or more.
async function call(base, method, path, { headers = {}, body } = {}) {
	const reply = await fetch(`${base}${path}`, {
		method,
		headers: {
			...headers,
			...(body ? { "content-type": "application/json" } : {}),
			// The web server refuses a POST that does not come from its own page.
			...(method === "GET" ? {} : { origin }),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	// The cookies the reply set, as the `cookie` header that sends them back.
	const cookie = reply.headers
		.getSetCookie()
		.filter((value) => !value.includes("Max-Age=0"))
		.map((value) => value.split(";")[0])
		.join("; ");
	return { status: reply.status, body: await reply.json(), cookie };
}

// A reply that is not the one expected stops the walk, with what came back.
function expectOk(label, reply, status) {
	if (reply.status >= STATUS.firstError) {
		throw new Error(`${label}: refused with ${JSON.stringify(reply.body)}`);
	}
	if (status !== undefined && reply.status !== status) {
		throw new Error(`${label}: status ${reply.status}, wanted ${status}`);
	}
	return reply.body;
}

function expectRefusal(label, reply, errorCode) {
	if (reply.body.errorCode !== errorCode) {
		throw new Error(
			`${label}: wanted ${errorCode}, got ${JSON.stringify(reply.body)}`,
		);
	}
}

// Brings the stack up and checks that every API instance is healthy behind nginx.
async function startStack() {
	step(`building and starting the stack (api on ${bePort}, web on ${webPort})`);
	compose("up", "-d", "--build", "--wait");

	step("three API instances are healthy behind nginx");
	const running = JSON.parse(
		`[${compose("ps", "--format", "json").trim().split("\n").join(",")}]`,
	)
		.filter((container) => API_INSTANCES.includes(container.Service))
		.filter((container) => container.Health === "healthy");
	if (running.length !== API_INSTANCES.length) {
		throw new Error(
			`wanted ${API_INSTANCES.length} healthy API instances, found ${running.length}`,
		);
	}
}

async function checkReady(apiUrl) {
	step("the API is ready");
	const ready = await fetch(`${apiUrl}/ready`);
	if (ready.status !== STATUS.ok)
		throw new Error(`/ready answered ${ready.status}`);
}

// The shopper signs up through the web server and gets the cookie that logs them in.
async function signUpShopper(web) {
	step(
		"a shopper signs up through the web server and is refused on the admin route",
	);
	const account = await web("POST", "/auth/register", {
		body: { username: SHOPPER, password },
	});
	expectOk("sign up", account, STATUS.created);
	return account.cookie;
}

// The sale the walk creates: it started a minute ago and runs for an hour.
function saleRequest() {
	return {
		stock: 2,
		holdSeconds: 60,
		startsAt: new Date(Date.now() - MINUTE_MS).toISOString(),
		endsAt: new Date(Date.now() + 60 * MINUTE_MS).toISOString(),
	};
}

// A shopper and a visitor with no login must both be refused by the admin route.
async function refusedOnAdmin(api, shopperCookie, body) {
	expectRefusal(
		"no login",
		await api("POST", "/admin/sales", { body }),
		"not_authenticated",
	);
	expectRefusal(
		"shopper",
		await api("POST", "/admin/sales", {
			headers: { cookie: shopperCookie },
			body,
		}),
		"forbidden",
	);
}

// The operator is made with the command, logs in, and creates the sale through the API.
async function createSaleAsOperator(api, body) {
	step(
		"an operator is made with the command, logs in and creates a sale through the API",
	);
	compose(
		"run",
		"--rm",
		"--no-deps",
		"flash-be-1",
		"node",
		"dist/create-operator.js",
		"--username",
		OPERATOR,
		"--password",
		password,
	);
	const operator = await api("POST", "/auth/login", {
		body: { username: OPERATOR, password },
	});
	expectOk("operator login", operator, STATUS.ok);
	const sale = expectOk(
		"create sale",
		await api("POST", "/admin/sales", {
			headers: { cookie: operator.cookie },
			body,
		}),
		STATUS.created,
	);
	return { sale, cookie: operator.cookie };
}

// The web server must not pass the admin route on, even to an operator.
async function checkWebBlocksAdmin(operatorCookie) {
	step("the web server does not pass the admin route on");
	const blocked = await fetch(`http://127.0.0.1:${webPort}/api/admin/sales`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			cookie: operatorCookie,
			origin,
		},
		body: "{}",
	});
	if (blocked.status !== STATUS.notFound) {
		throw new Error(`the web server answered ${blocked.status} to /api/admin`);
	}
}

async function checkShopperSeesSale(web, sale) {
	step("the shopper sees the sale through the web server");
	const current = expectOk(
		"current sale",
		await web("GET", "/sales/current"),
		STATUS.ok,
	);
	if (current.id !== sale.id)
		throw new Error("the current sale is not the new one");
}

// The shopper joins the queue and waits to be admitted. Returns the headers that carry the queue ticket.
async function joinAndWaitForAdmission(web, salePath, shopperCookie) {
	step("the shopper joins the queue and is admitted");
	const logged = { cookie: shopperCookie };
	const joined = expectOk(
		"join",
		await web("POST", `${salePath}/queue`, { headers: logged }),
	);
	const headers = { ...logged, [TICKET_HEADER]: joined.ticket };
	let state = joined.state;
	for (
		let tries = 0;
		state !== "admitted" && tries < MAX_ADMISSION_CHECKS;
		tries++
	) {
		await sleep(ADMISSION_CHECK_MS);
		const place = expectOk(
			"place",
			await web("GET", `${salePath}/queue/me`, { headers }),
			STATUS.ok,
		);
		state = place.state;
	}
	if (state !== "admitted") throw new Error("the shopper was never admitted");
	return headers;
}

async function holdItem(web, salePath, headers) {
	step("the shopper holds one item");
	return expectOk(
		"reserve",
		await web("POST", `${salePath}/reservations`, { headers }),
	);
}

// Pays for the hold. A declined charge is tried again, up to MAX_PAYMENT_ATTEMPTS, and the purchase is returned.
async function payForItem(web, salePath, shopperCookie, held) {
	step("the shopper pays (a declined charge is tried again)");
	let purchase;
	for (
		let attempt = 0;
		purchase === undefined && attempt < MAX_PAYMENT_ATTEMPTS;
		attempt++
	) {
		const paid = await web("POST", `${salePath}/purchases`, {
			headers: { cookie: shopperCookie },
			body: { reservationId: held.reservationId },
		});
		if (paid.status < STATUS.firstError) purchase = paid.body;
		else if (paid.body.errorCode !== "payment_failed") {
			throw new Error(`confirm: ${JSON.stringify(paid.body)}`);
		}
	}
	if (purchase === undefined)
		throw new Error("the payment was declined every time");
	return purchase;
}

// The shopper learns they bought the item, and a second hold is refused.
async function checkOutcome(web, salePath, shopperCookie, headers) {
	step("the shopper asks if they got it, and cannot buy twice");
	const outcome = expectOk(
		"outcome",
		await web("GET", `${salePath}/purchases/me`, {
			headers: { cookie: shopperCookie },
		}),
		STATUS.ok,
	);
	if (outcome.state !== "purchased") {
		throw new Error(`the outcome is ${outcome.state}, wanted purchased`);
	}
	expectRefusal(
		"second reserve",
		await web("POST", `${salePath}/reservations`, { headers }),
		"already_purchased",
	);
}

// The whole walk, one phase after another. Each phase stops the walk by throwing when a reply is not the one expected.
async function walk() {
	await startStack();
	const apiUrl = `http://127.0.0.1:${bePort}`;
	const api = (method, path, options) => call(apiUrl, method, path, options);
	const web = (method, path, options) =>
		call(`http://127.0.0.1:${webPort}/api`, method, path, options);

	await checkReady(apiUrl);
	const shopperCookie = await signUpShopper(web);
	const body = saleRequest();
	await refusedOnAdmin(api, shopperCookie, body);
	const { sale, cookie: operatorCookie } = await createSaleAsOperator(
		api,
		body,
	);
	await checkWebBlocksAdmin(operatorCookie);
	await checkShopperSeesSale(web, sale);

	const salePath = `/sales/${sale.id}`;
	const headers = await joinAndWaitForAdmission(web, salePath, shopperCookie);
	const held = await holdItem(web, salePath, headers);
	await payForItem(web, salePath, shopperCookie, held);
	await checkOutcome(web, salePath, shopperCookie, headers);
}

try {
	await walk();
} finally {
	console.log("- removing the stack and its volumes");
	compose("down", "-v", "--remove-orphans");
}
console.log("smoke:prod passed");
