import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { specFile } from "./support/paths.js";
import { queueWorld, type Response } from "./support/queue-world.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date("2026-06-01T12:00:00Z");

// A scenario body runs once when the tests are collected, and each step then runs as its own test.
function newWorld() {
	return queueWorld(NOW);
}

type World = ReturnType<typeof newWorld>;

function response(world: World): Response {
	if (!world.response) throw new Error("no request was sent");
	return world.response;
}

async function openSale(world: World, sold: number) {
	await world.addSale({
		stock: 10,
		sold,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

const SALE_WITH_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";
const SALE_WITH_0 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/caching.feature")),
	({ Scenario }) => {
		Scenario(
			"A sale read is answered from the cache for the cache time",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_WITH_3, async () => openSale(world, 3));

				And(
					"the sale reads are cached for {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setSaleCache(seconds * 1000);
					},
				);

				And("a client has asked for that sale", async () => {
					await world.readSale();
				});

				When("the sold count changes to {int}", async (_ctx, sold: number) => {
					await world.setSold(sold);
				});

				And("a client asks for that sale again", async () => {
					await world.readSale();
				});

				Then("the reply shows {int} items remaining", (_ctx, left: number) => {
					expect(response(world).json().remaining).toBe(left);
				});
			},
		);

		Scenario(
			"A change shows once the cache time is over",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_WITH_3, async () => openSale(world, 3));

				And(
					"the sale reads are cached for {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setSaleCache(seconds * 1000);
					},
				);

				And("a client has asked for that sale", async () => {
					await world.readSale();
				});

				When("the sold count changes to {int}", async (_ctx, sold: number) => {
					await world.setSold(sold);
				});

				And("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				And("a client asks for that sale again", async () => {
					await world.readSale();
				});

				Then("the reply shows {int} items remaining", (_ctx, left: number) => {
					expect(response(world).json().remaining).toBe(left);
				});
			},
		);

		Scenario(
			"Without a cache time every read is fresh",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_WITH_3, async () => openSale(world, 3));

				And("the sale reads are not cached", async () => {
					await world.setSaleCache(0);
				});

				And("a client has asked for that sale", async () => {
					await world.readSale();
				});

				When("the sold count changes to {int}", async (_ctx, sold: number) => {
					await world.setSold(sold);
				});

				And("a client asks for that sale again", async () => {
					await world.readSale();
				});

				Then("the reply shows {int} items remaining", (_ctx, left: number) => {
					expect(response(world).json().remaining).toBe(left);
				});

				And("no Cache-Control header is given", () => {
					expect(response(world).headers["cache-control"]).toBeUndefined();
				});
			},
		);

		Scenario(
			"A cached reply tells clients how long they may keep it",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_WITH_3, async () => openSale(world, 3));

				And(
					"the sale reads are cached for {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setSaleCache(seconds * 1000);
					},
				);

				When("a client asks for that sale", async () => {
					await world.readSale();
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the Cache-Control header is {string}", (_ctx, header: string) => {
					expect(response(world).headers["cache-control"]).toBe(header);
				});
			},
		);

		Scenario(
			"A sale that is not found is not cached",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given("no sale exists", () => {});

				And(
					"the sale reads are cached for {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setSaleCache(seconds * 1000);
					},
				);

				And("a client has asked for the current sale", async () => {
					await world.readCurrentSale();
					expect(response(world).statusCode).toBe(404);
				});

				And(SALE_WITH_0, async () => openSale(world, 0));

				When("a client asks for the current sale", async () => {
					await world.readCurrentSale();
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});
			},
		);

		Scenario(
			"Joining the queue does not read the cache",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_WITH_3, async () => openSale(world, 3));

				And(
					"the sale reads are cached for {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setSaleCache(seconds * 1000);
					},
				);

				And("a client has asked for that sale", async () => {
					await world.readSale();
				});

				And("the sold count changes to {int}", async (_ctx, sold: number) => {
					await world.setSold(sold);
				});

				When('"ana" joins the queue', async () => {
					await world.join("ana");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().errorCode).toBe(error);
				});

				When("a client asks for that sale again", async () => {
					await world.readSale();
				});

				Then("the reply shows {int} items remaining", (_ctx, left: number) => {
					expect(response(world).json().remaining).toBe(left);
				});
			},
		);
	},
);
