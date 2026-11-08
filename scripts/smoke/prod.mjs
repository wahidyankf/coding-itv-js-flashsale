// Smoke test of the production stack (compose.prod.yaml), under its own project name, with random secrets and free ports.
// An operator, made with the create-operator command, makes a sale through the API. A shopper then buys through the web server.
// One request through the web server is then traced by its request id, in the logs of nginx and of an API instance.
// Then Redis and one API instance each exit by themselves and must be started again by Docker. Last, a burst of logins
// through the web server checks that the API counts each shopper's address apart.
// At the end the stack and its volumes are removed.
// Usage: npm run smoke:prod   (needs Docker; builds the images, so the first run takes a few minutes)
import { randomBytes } from "node:crypto";
import path from "node:path";
// The API's paths, the status numbers and the retry come from flash-commons, the same ones flash-be and flash-web use.
// `npm run smoke:prod` builds flash-commons and typekit before this script runs, so the imports resolve to their dist.
import {
	API_PATHS,
	FIRST_ERROR_STATUS,
	HTTP_STATUS,
	PROBE_PATHS,
	retryAsync,
} from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok } from "@flash/typekit";
import { composeFor, freePort } from "./docker.mjs";
import { stackChecks } from "./stack-checks.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const PROJECT = "flash-smoke";
// The API instances in compose.prod.yaml. The run waits for all of them to be healthy.
const API_INSTANCES = ["flash-be-1", "flash-be-2", "flash-be-3"];
// The shopper checks the queue up to this many times before the run gives up. The wait between checks starts at the
// base and doubles up to the cap, with full jitter, so a slow queue is not hammered.
const ADMISSION_POLICY = { baseMs: 250, capMs: 1000, maxAttempts: 30 };
// A declined payment is tried up to this many times in total, with a short backoff between the tries.
const PAYMENT_POLICY = { baseMs: 100, capMs: 800, maxAttempts: 5 };
const MINUTE_MS = 60_000;
const TICKET_HEADER = "x-queue-ticket";
// Sign-ups and logins one address may make in a window: flash-be's default AUTH_RATE_LIMIT_PER_IP, which the stack keeps.
const AUTH_LIMIT = 20;
// The burst from one address must meet a 429 within this many logins. Earlier steps of the walk may have opened the
// window, which can close mid-burst; twice the limit plus one still reaches the limit in the window that follows.
const AUTH_BURST_MAX = 2 * (AUTH_LIMIT + 1);
// Logins sent from a second address once the first is limited. Any number up to the limit would do.
const SECOND_ADDRESS_LOGINS = 3;
// flash-web's port inside the compose network, where another container reaches it.
const WEB_INTERNAL_URL = "http://flash-web:3000";

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

const stack = composeFor({
	root,
	env,
	project: PROJECT,
	file: "compose.prod.yaml",
});
const compose = stack.run;

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
	if (reply.status >= FIRST_ERROR_STATUS) {
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
	const ready = await fetch(`${apiUrl}${PROBE_PATHS.ready}`);
	if (ready.status !== HTTP_STATUS.ok)
		throw new Error(`/ready answered ${ready.status}`);
}

// The shopper signs up through the web server and gets the cookie that logs them in.
async function signUpShopper(web) {
	step(
		"a shopper signs up through the web server and is refused on the admin route",
	);
	const account = await web("POST", API_PATHS.authRegister, {
		body: { username: SHOPPER, password },
	});
	expectOk("sign up", account, HTTP_STATUS.created);
	return account.cookie;
}

// The API paths of one sale, with its id filled into the `:saleId` placeholder.
function routesOf(saleId) {
	const fill = (template) => template.replace(":saleId", saleId);
	return {
		queue: fill(API_PATHS.queue),
		queueMe: fill(API_PATHS.queueMe),
		reservations: fill(API_PATHS.reservations),
		purchases: fill(API_PATHS.purchases),
		purchaseMe: fill(API_PATHS.purchaseMe),
	};
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
		await api("POST", API_PATHS.adminSales, { body }),
		"not_authenticated",
	);
	expectRefusal(
		"shopper",
		await api("POST", API_PATHS.adminSales, {
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
	const operator = await api("POST", API_PATHS.authLogin, {
		body: { username: OPERATOR, password },
	});
	expectOk("operator login", operator, HTTP_STATUS.ok);
	const sale = expectOk(
		"create sale",
		await api("POST", API_PATHS.adminSales, {
			headers: { cookie: operator.cookie },
			body,
		}),
		HTTP_STATUS.created,
	);
	return { sale, cookie: operator.cookie };
}

// The web server must not pass the admin route on, even to an operator.
async function checkWebBlocksAdmin(operatorCookie) {
	step("the web server does not pass the admin route on");
	const blocked = await fetch(`${origin}${API_PATHS.adminSales}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			cookie: operatorCookie,
			origin,
		},
		body: "{}",
	});
	if (blocked.status !== HTTP_STATUS.notFound) {
		throw new Error(
			`the web server answered ${blocked.status} to ${API_PATHS.adminSales}`,
		);
	}
}

async function checkShopperSeesSale(web, sale) {
	step("the shopper sees the sale through the web server");
	const current = expectOk(
		"current sale",
		await web("GET", API_PATHS.saleCurrent),
		HTTP_STATUS.ok,
	);
	if (current.id !== sale.id)
		throw new Error("the current sale is not the new one");
}

// The shopper joins the queue and waits to be admitted. Returns the headers that carry the queue ticket.
async function joinAndWaitForAdmission(web, routes, shopperCookie) {
	step("the shopper joins the queue and is admitted");
	const logged = { cookie: shopperCookie };
	const joined = expectOk(
		"join",
		await web("POST", routes.queue, { headers: logged }),
	);
	const headers = { ...logged, [TICKET_HEADER]: joined.ticket };
	if (joined.state === "admitted") return headers;
	const admitted = await retryAsync(
		async () => {
			const place = expectOk(
				"place",
				await web("GET", routes.queueMe, { headers }),
				HTTP_STATUS.ok,
			);
			return place.state === "admitted" ? new Ok(place) : new Err(place.state);
		},
		{ ...ADMISSION_POLICY, sleep, random: Math.random },
	);
	if (admitted.isErr()) throw new Error("the shopper was never admitted");
	return headers;
}

async function holdItem(web, routes, headers) {
	step("the shopper holds one item");
	return expectOk(
		"reserve",
		await web("POST", routes.reservations, { headers }),
	);
}

// Pays for the hold. A declined charge is tried again, up to PAYMENT_POLICY.maxAttempts, and the purchase is returned.
async function payForItem(web, routes, shopperCookie, held) {
	step("the shopper pays (a declined charge is tried again)");
	const declined = "payment_failed";
	const paid = await retryAsync(
		async () => {
			const reply = await web("POST", routes.purchases, {
				headers: { cookie: shopperCookie },
				body: { reservationId: held.reservationId },
			});
			if (reply.status < FIRST_ERROR_STATUS) return new Ok(reply.body);
			if (reply.body.errorCode !== declined) {
				throw new Error(`confirm: ${JSON.stringify(reply.body)}`);
			}
			return new Err(declined);
		},
		{ ...PAYMENT_POLICY, sleep, random: Math.random },
	);
	if (paid.isErr()) throw new Error("the payment was declined every time");
	return paid.value;
}

// The shopper learns they bought the item, and a second hold is refused.
async function checkOutcome(web, routes, shopperCookie, headers) {
	step("the shopper asks if they got it, and cannot buy twice");
	const outcome = expectOk(
		"outcome",
		await web("GET", routes.purchaseMe, {
			headers: { cookie: shopperCookie },
		}),
		HTTP_STATUS.ok,
	);
	if (outcome.state !== "purchased") {
		throw new Error(`the outcome is ${outcome.state}, wanted purchased`);
	}
	expectRefusal(
		"second reserve",
		await web("POST", routes.reservations, { headers }),
		"already_purchased",
	);
}

// Logs in through the web server from a fresh container on the compose network, so from an address that is not this
// machine's. Returns the status of each try.
function loginsFromAnotherAddress(body) {
	const script = [
		"const [url, count, body] = process.argv.slice(1);",
		"const statuses = [];",
		"for (let i = 0; i < Number(count); i += 1) {",
		'  const reply = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });',
		"  statuses.push(reply.status);",
		"}",
		"console.log(JSON.stringify(statuses));",
	].join("\n");
	const printed = compose(
		"run",
		"--rm",
		"--no-deps",
		"flash-be-1",
		"node",
		"--input-type=module",
		"-e",
		script,
		`${WEB_INTERNAL_URL}${API_PATHS.authLogin}`,
		String(SECOND_ADDRESS_LOGINS),
		JSON.stringify(body),
	);
	return JSON.parse(printed.trim().split("\n").at(-1));
}

// The API counts the logins of the page by the address of each shopper, not by the web server's. A burst from this
// machine through the web server meets the limit, even with a new X-Forwarded-For on every try, because the web server
// writes the address itself. A shopper at another address is then still let in. Runs last: it uses up this machine's
// logins for the window.
async function checkAuthLimitPerAddress(web) {
	step(
		"a burst of logins through the web server is limited per address, and a written address does not dodge it",
	);
	const body = { username: SHOPPER, password: secret() };
	let tries = 0;
	let limited = false;
	while (!limited && tries < AUTH_BURST_MAX) {
		tries += 1;
		const reply = await web("POST", API_PATHS.authLogin, {
			headers: { "x-forwarded-for": `198.51.100.${tries}` },
			body,
		});
		limited = reply.status === HTTP_STATUS.tooManyRequests;
	}
	if (!limited) {
		throw new Error(
			`${AUTH_BURST_MAX} logins from one address were never limited`,
		);
	}

	step("a shopper at another address can still log in through the web server");
	const statuses = loginsFromAnotherAddress(body);
	if (statuses.includes(HTTP_STATUS.tooManyRequests)) {
		throw new Error(
			`another address was limited with this one: ${JSON.stringify(statuses)}`,
		);
	}
}

// The whole walk, one phase after another. Each phase stops the walk by throwing when a reply is not the one expected.
async function walk() {
	await startStack();
	const apiUrl = `http://127.0.0.1:${bePort}`;
	const api = (method, path, options) => call(apiUrl, method, path, options);
	const web = (method, path, options) => call(origin, method, path, options);

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

	const routes = routesOf(sale.id);
	const headers = await joinAndWaitForAdmission(web, routes, shopperCookie);
	const held = await holdItem(web, routes, headers);
	await payForItem(web, routes, shopperCookie, held);
	await checkOutcome(web, routes, shopperCookie, headers);
	const checks = stackChecks({ stack, step, origin, instances: API_INSTANCES });
	await checks.checkTrace();
	await checks.checkRecovery(() => checkShopperSeesSale(web, sale));
	await checkAuthLimitPerAddress(web);
}

try {
	await walk();
} finally {
	console.log("- removing the stack and its volumes");
	compose("down", "-v", "--remove-orphans");
}
console.log("smoke:prod passed");
