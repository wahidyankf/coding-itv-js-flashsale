// Steps for the web server's /api proxy: a shopper's request reaches the API through it, the cookies a reply sets must be
// HttpOnly on the right path, the body must not hold a token, a request from another site must not reach the API, and the API
// is told the address the request came from. Binds proxy/api.feature.

import { API_PATHS, parseSetCookie } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { E2E_PASSWORD } from "../../flash-be-e2e/steps/support/auth.js";
import {
	currentResponse,
	setCookiesOf,
	setResponse,
} from "../../flash-be-e2e/steps/support/response.js";
import {
	currentSaleId,
	world,
} from "../../flash-be-e2e/steps/support/world.js";
import { saleRoute } from "./support/api.js";
import { FORWARDER_URL, forwarder } from "./support/forwarder.js";
import { answerWith, connectWebServer } from "./support/shop.js";

const { When, Then } = createBdd();

// The tests and the web server run on one machine, so a request reaches the web server from a loopback address. Which
// one depends on whether the server listens on IPv4, IPv6 or both.
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const FORWARDED_FOR = "x-forwarded-for";

// The client is the page's own browser context, so it sends the cookies the page holds, if there are any.
When("a client joins the queue through the web server", async ({ page }) => {
	await connectWebServer();
	// The browser reaches the API through the web server, under the API prefix.
	setResponse(
		await page.request.post(saleRoute(API_PATHS.queue, currentSaleId()), {
			data: {},
		}),
	);
});

When(
	/^a client signs up through the web server as "([^"]+)"$/,
	async ({ request }, user: string) => {
		await connectWebServer();
		setResponse(
			await request.post(API_PATHS.authRegister, {
				data: { username: user, password: E2E_PASSWORD },
			}),
		);
	},
);

// The cookies of the shopper are sent along, so that only the check of the web server stands between them and the API.
When(
	/^a client on another site sends POST \/api\/v1\/auth\/logout$/,
	async ({ page, context }) => {
		const cookie = (await context.cookies())
			.map(({ name, value }) => `${name}=${value}`)
			.join("; ");
		setResponse(
			await page.request.post(API_PATHS.authLogout, {
				data: {},
				headers: { origin: "http://evil.test", cookie },
			}),
		);
	},
);

Then(
	/^the response sets the cookie "([^"]+)" for the path "([^"]+)"$/,
	async ({ request: _request }, name: string, path: string) => {
		const cookie = setCookiesOf(currentResponse()).find((value) =>
			value.startsWith(`${name}=`),
		);
		expect(cookie, `a cookie named ${name}`).toBeDefined();
		expect(parseSetCookie(cookie ?? "").path).toBe(path);
	},
);

Then("both cookies are HttpOnly", async ({ request: _request }) => {
	const cookies = setCookiesOf(currentResponse());
	expect(cookies).toHaveLength(2);
	for (const cookie of cookies) {
		expect(parseSetCookie(cookie).httpOnly).toBe(true);
	}
});

Then("the body holds neither token", async ({ request: _request }) => {
	const body = await currentResponse().text();
	for (const cookie of setCookiesOf(currentResponse())) {
		const { value } = parseSetCookie(cookie);
		expect(value).not.toBe("");
		expect(body).not.toContain(value);
	}
});

// A logout that reached the API would have ended the login of the shopper. It still works, so the request never got there.
Then("the API was not asked", async ({ page }) => {
	const me = await page.request.get(API_PATHS.authMe);
	expect(me.status()).toBe(200);
});

Then(
	/^the body names "([^"]+)"$/,
	async ({ request: _request }, name: string) => {
		expect((await currentResponse().json()).userId).toBe(name);
	},
);

Then(
	/^the body has error "([^"]+)"$/,
	async ({ request: _request }, error: string) => {
		expect((await currentResponse().json()).errorCode).toBe(error);
	},
);

Then("the body names the sale", async ({ request: _request }) => {
	expect((await currentResponse().json()).id).toBe(world.saleId);
});

Then("the body has a ticket", async ({ request: _request }) => {
	expect(typeof (await currentResponse().json()).ticket).toBe("string");
});

Then("the page does not contain the address of the API", async ({ page }) => {
	expect(await page.content()).not.toContain(FORWARDER_URL);
	expect(await page.content()).not.toContain(new URL(FORWARDER_URL).host);
});

// The API gives a canned reply, so the forwarder holds the request exactly as the real web server sent it.
When(
	/^a client that writes its address as "([^"]+)" sends GET \/api\/v1\/sales\/current$/,
	async ({ request }, written: string) => {
		await answerWith(200, "{}");
		setResponse(
			await request.get(API_PATHS.saleCurrent, {
				headers: { [FORWARDED_FOR]: written },
			}),
		);
	},
);

Then(
	"the API is told the address the request came from",
	async ({ request: _request }) => {
		expect(LOOPBACK).toContain(forwarder.headerOfLast(FORWARDED_FOR) ?? "none");
	},
);

Then(
	/^the API is not told "([^"]+)"$/,
	async ({ request: _request }, written: string) => {
		expect(forwarder.headerOfLast(FORWARDED_FOR) ?? "").not.toContain(written);
	},
);
