import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { specFile } from "./support/paths.js";
import { openQueueIntegration } from "./support/queue-integration.js";
import type { Response, ShopScenario } from "./support/queue-world.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date();

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);

function newWorld() {
	return real.scenario();
}

type World = ShopScenario;

function response(world: World): Response {
	if (!world.response) throw new Error("no request was sent");
	return world.response;
}

async function openSale(world: World) {
	await world.addSale({
		stock: 1,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/recovery/rebuild.feature")),
	({ Scenario }) => {
		Scenario(
			"Live holds survive the loss of Redis state",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ben" has been admitted', async () => {
					await world.admitted("ben");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				And(
					"the reservation state of the sale is lost from Redis",
					async () => {
						await world.loseReservationState();
					},
				);

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"The holder gets the same hold after the loss",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				And(
					"the reservation state of the sale is lost from Redis",
					async () => {
						await world.loseReservationState();
					},
				);

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And(
					"the reservation is the one {string} had before",
					(_ctx, user: string) => {
						expect(response(world).json()).toEqual(world.holds.get(user));
					},
				);
			},
		);

		Scenario("Expired holds are not rebuilt", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(
				"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
				async () => openSale(world),
			);

			And(
				"the hold time of the sale is {int} second",
				async (_ctx, seconds: number) => {
					await world.setHoldSeconds(seconds);
				},
			);

			And('"ana" has been admitted', async () => {
				await world.admitted("ana");
			});

			And('"ben" has been admitted', async () => {
				await world.admitted("ben");
			});

			And("{string} has reserved an item", async (_ctx, user: string) => {
				await world.reserve(user);
			});

			And("the reservation state of the sale is lost from Redis", async () => {
				await world.loseReservationState();
			});

			When("{int} seconds pass", async (_ctx, seconds: number) => {
				await world.advance(seconds);
			});

			And("{string} reserves an item", async (_ctx, user: string) => {
				await world.reserve(user);
			});

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});
		});
	},
);
