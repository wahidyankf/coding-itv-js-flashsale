// The steps of specs/apps/flash/be/behaviours/sale/caching.feature, as both layers bind them. Each scenario gets the world
// its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import type { ShopScenario } from "./queue-scenario.js";
import { responseOf } from "./response.js";
import {
	OPEN_SALE,
	openSale,
	type ShopLayer,
	secondsPass,
} from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";

const SALE_WITH_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";

// "the sale reads are cached for {int} seconds": the cache keeps a read for that long.
function cachedFor(world: ShopScenario) {
	return async (_ctx: unknown, seconds: number) => {
		await world.setSaleCache(seconds * 1000);
	};
}

// "the reply shows {int} items remaining": the public read of the sale says how many are left.
function remainingIs(world: ShopScenario) {
	return (_ctx: unknown, left: number) => {
		expect(responseOf(world).json().remaining).toBe(left);
	};
}

// "the sold count changes to {int}": another instance sells, behind the cache.
function soldCountIs(world: ShopScenario) {
	return async (_ctx: unknown, sold: number) => {
		await world.setSold(sold);
	};
}

function cachedRead(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_WITH_3, async () =>
			openSale(world, layer.now, { stock: 10, sold: 3 }),
		);

		And("the sale reads are cached for {int} seconds", cachedFor(world));

		And("a client has asked for that sale", async () => {
			await world.readSale();
		});

		When("the sold count changes to {int}", soldCountIs(world));

		And("a client asks for that sale again", async () => {
			await world.readSale();
		});

		Then("the reply shows {int} items remaining", remainingIs(world));
	};
}

function changeAfterCache(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_WITH_3, async () =>
			openSale(world, layer.now, { stock: 10, sold: 3 }),
		);

		And("the sale reads are cached for {int} seconds", cachedFor(world));

		And("a client has asked for that sale", async () => {
			await world.readSale();
		});

		When("the sold count changes to {int}", soldCountIs(world));

		And("{int} seconds pass", secondsPass(world));

		And("a client asks for that sale again", async () => {
			await world.readSale();
		});

		Then("the reply shows {int} items remaining", remainingIs(world));
	};
}

function freshWithoutCache(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_WITH_3, async () =>
			openSale(world, layer.now, { stock: 10, sold: 3 }),
		);

		And("the sale reads are not cached", async () => {
			await world.setSaleCache(0);
		});

		And("a client has asked for that sale", async () => {
			await world.readSale();
		});

		When("the sold count changes to {int}", soldCountIs(world));

		And("a client asks for that sale again", async () => {
			await world.readSale();
		});

		Then("the reply shows {int} items remaining", remainingIs(world));

		And("no Cache-Control header is given", () => {
			expect(responseOf(world).headers["cache-control"]).toBeUndefined();
		});
	};
}

function tellsCacheTime(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_WITH_3, async () =>
			openSale(world, layer.now, { stock: 10, sold: 3 }),
		);

		And("the sale reads are cached for {int} seconds", cachedFor(world));

		When("a client asks for that sale", async () => {
			await world.readSale();
		});

		Then("the response status is {int}", statusIs(world));

		And("the Cache-Control header is {string}", (_ctx, header: string) => {
			expect(responseOf(world).headers["cache-control"]).toBe(header);
		});
	};
}

function notFoundNotCached(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given("no sale exists", () => {});

		And("the sale reads are cached for {int} seconds", cachedFor(world));

		And("a client has asked for the current sale", async () => {
			await world.readCurrentSale();
			expect(responseOf(world).statusCode).toBe(404);
		});

		And(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		When("a client asks for the current sale", async () => {
			await world.readCurrentSale();
		});

		Then("the response status is {int}", statusIs(world));
	};
}

function joiningSkipsCache(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_WITH_3, async () =>
			openSale(world, layer.now, { stock: 10, sold: 3 }),
		);

		And("the sale reads are cached for {int} seconds", cachedFor(world));

		And("a client has asked for that sale", async () => {
			await world.readSale();
		});

		And("the sold count changes to {int}", soldCountIs(world));

		When('"ana" joins the queue', async () => {
			await world.join("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		When("a client asks for that sale again", async () => {
			await world.readSale();
		});

		Then("the reply shows {int} items remaining", remainingIs(world));
	};
}

// The steps of each scenario in the caching feature, by the scenario's name in the feature's own words.
export function bindSaleCaching(layer: ShopLayer) {
	return {
		cachedRead: cachedRead(layer),
		changeAfterCache: changeAfterCache(layer),
		freshWithoutCache: freshWithoutCache(layer),
		tellsCacheTime: tellsCacheTime(layer),
		notFoundNotCached: notFoundNotCached(layer),
		joiningSkipsCache: joiningSkipsCache(layer),
	};
}
