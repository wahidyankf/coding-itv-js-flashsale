import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { salePath } from "./support/api.js";
import { FORWARDER_URL } from "./support/forwarder.js";
import { connectWebServer, world } from "./support/shop.js";
import { current, setResponse } from "./web.steps.js";

const { When, Then } = createBdd();

When("a client joins the queue through the web server", async ({ request }) => {
	await connectWebServer();
	// The browser reaches the API through the web server, under /api.
	setResponse(
		await request.post(`/api${salePath(world.saleId)}/queue`, {
			data: { userId: "ana" },
		}),
	);
});

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
