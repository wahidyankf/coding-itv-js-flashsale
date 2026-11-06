import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { routes, send } from "./support/api.js";
import { currentResponse, setResponse } from "./support/response.js";
import { query, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

Given(
	/^the sale reads are cached for (\d+) seconds$/,
	async ({ request: _request }, seconds: string) => {
		world.apiEnv = {
			...world.apiEnv,
			SALE_CACHE_MS: String(Number(seconds) * 1000),
		};
	},
);

Given("the sale reads are not cached", async ({ request: _request }) => {
	world.apiEnv = { ...world.apiEnv, SALE_CACHE_MS: "0" };
});

Given("a client has asked for that sale", async ({ request }) => {
	setResponse(
		await send(request, routes.sale, {
			params: { saleId: world.saleId ?? "" },
		}),
	);
});

// Nothing exists yet, so this read is the "not found" the cache must not keep.
Given("a client has asked for the current sale", async ({ request }) => {
	const reply = await send(request, routes.currentSale, {});
	expect(reply.status()).toBe(404);
	setResponse(reply);
});

// Changes the row behind the API's back, the way another instance would.
When(
	/^the sold count changes to (\d+)$/,
	async ({ request: _request }, sold: string) => {
		await query("update sales set sold = $1 where id = $2", [
			Number(sold),
			world.saleId,
		]);
	},
);

When("a client asks for that sale again", async ({ request }) => {
	setResponse(
		await send(request, routes.sale, {
			params: { saleId: world.saleId ?? "" },
		}),
	);
});

Then(
	/^the reply shows (\d+) items remaining$/,
	async ({ request: _request }, left: string) => {
		expect((await currentResponse().json()).remaining).toBe(Number(left));
	},
);

Then("no Cache-Control header is given", async ({ request: _request }) => {
	expect(currentResponse().headers()["cache-control"]).toBeUndefined();
});

Then(
	/^the Cache-Control header is "([^"]+)"$/,
	async ({ request: _request }, header: string) => {
		expect(currentResponse().headers()["cache-control"]).toBe(header);
	},
);
