import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { salePath } from "./support/api.js";
import { FORWARDER_URL } from "./support/forwarder.js";
import { connectWebServer, E2E_PASSWORD, world } from "./support/shop.js";
import { current, setResponse } from "./web.steps.js";

const { When, Then } = createBdd();

// The client is the page's own browser context, so it sends the cookies the page holds, if there are any.
When("a client joins the queue through the web server", async ({ page }) => {
	await connectWebServer();
	// The browser reaches the API through the web server, under /api.
	setResponse(
		await page.request.post(`/api${salePath(world.saleId)}/queue`, {
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

const setCookiesOf = (response: APIResponse): string[] =>
	response
		.headersArray()
		.filter(({ name }) => name.toLowerCase() === "set-cookie")
		.map(({ value }) => value);

Then(
	/^the response sets the cookie "([^"]+)" for the path "([^"]+)"$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, name: string, path: string) => {
		const cookie = setCookiesOf(current()).find((value) =>
			value.startsWith(`${name}=`),
		);
		expect(cookie, `a cookie named ${name}`).toBeDefined();
		expect((cookie ?? "").split(";").map((part) => part.trim())).toContain(
			`Path=${path}`,
		);
	},
);

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then("both cookies are HttpOnly", async ({}) => {
	const cookies = setCookiesOf(current());
	expect(cookies).toHaveLength(2);
	for (const cookie of cookies) {
		expect(cookie.split(";").map((part) => part.trim())).toContain("HttpOnly");
	}
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then("the body holds neither token", async ({}) => {
	const body = await current().text();
	for (const cookie of setCookiesOf(current())) {
		const token = cookie.split(";")[0]?.split("=")[1] ?? "";
		expect(token).not.toBe("");
		expect(body).not.toContain(token);
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
		expect((await current().json()).userId).toBe(name);
	},
);

Then(
	/^the body has error "([^"]+)"$/,
	async ({ request: _request }, error: string) => {
		expect((await current().json()).errorCode).toBe(error);
	},
);

Then("the body names the sale", async ({ request: _request }) => {
	expect((await current().json()).id).toBe(world.saleId);
});

Then("the body has a ticket", async ({ request: _request }) => {
	expect(typeof (await current().json()).ticket).toBe("string");
});

Then("the page does not contain the address of the API", async ({ page }) => {
	expect(await page.content()).not.toContain(FORWARDER_URL);
	expect(await page.content()).not.toContain(new URL(FORWARDER_URL).host);
});
