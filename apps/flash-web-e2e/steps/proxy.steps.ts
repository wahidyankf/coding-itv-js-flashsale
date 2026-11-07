// Steps for the web server's /api proxy: a shopper's request reaches the API through it, the cookies a reply sets must be
// HttpOnly on the right path, the body must not hold a token, and a request from another site must not reach the API.
// Binds proxy/api.feature.

import { parseSetCookie } from "@flash/flash-commons";
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
import { salePath } from "./support/api.js";
import { FORWARDER_URL } from "./support/forwarder.js";
import { connectWebServer } from "./support/shop.js";

const { When, Then } = createBdd();

// The client is the page's own browser context, so it sends the cookies the page holds, if there are any.
When("a client joins the queue through the web server", async ({ page }) => {
	await connectWebServer();
	// The browser reaches the API through the web server, under /api.
	setResponse(
		await page.request.post(`/api${salePath(currentSaleId())}/queue`, {
			data: {},
		}),
	);
});

When(
	/^a client signs up through the web server as "([^"]+)"$/,
	async ({ request }, user: string) => {
		await connectWebServer();
		setResponse(
			await request.post("/api/auth/register", {
				data: { username: user, password: E2E_PASSWORD },
			}),
		);
	},
);

// The cookies of the shopper are sent along, so that only the check of the web server stands between them and the API.
When(
	/^a client on another site sends POST \/api\/auth\/logout$/,
	async ({ page, context }) => {
		const cookie = (await context.cookies())
			.map(({ name, value }) => `${name}=${value}`)
			.join("; ");
		setResponse(
			await page.request.post("/api/auth/logout", {
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
	const me = await page.request.get("/api/auth/me");
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
