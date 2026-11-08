// Steps for the cache of sale reads: how long the API keeps a sale, a change another instance makes, and the Cache-Control
// header it sends. Binds sale/caching.feature. The request and reply steps are in be.steps.ts.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { routes, send } from "./support/api.js";
import { setSold } from "./support/database.js";
import { currentResponse, setResponse } from "./support/response.js";
import { saleNow } from "./support/sale.js";
import { currentSaleId, setApiEnv } from "./support/world.js";

const { Given, When, Then } = createBdd();

Given(
	/^the sale reads are cached for (\d+) seconds$/,
	async ({ request: _request }, seconds: string) => {
		setApiEnv({ SALE_CACHE_MS: String(Number(seconds) * MS_PER_SECOND) });
	},
);

Given("the sale reads are not cached", async ({ request: _request }) => {
	setApiEnv({ SALE_CACHE_MS: "0" });
});

Given("a client has asked for that sale", async ({ request }) => {
	setResponse(await saleNow(request));
});

// Nothing exists yet, so this read is the "not found" the cache must not keep.
Given("a client has asked for the current sale", async ({ request }) => {
	const reply = await send(request, routes.currentSale, {});
	expect(reply.status()).toBe(404);
	setResponse(reply);
});

// Changes the row directly, as another instance would.
When(
	/^the sold count changes to (\d+)$/,
	async ({ request: _request }, sold: string) => {
		await setSold(currentSaleId(), Number(sold));
	},
);

When("a client asks for that sale again", async ({ request }) => {
	setResponse(await saleNow(request));
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
