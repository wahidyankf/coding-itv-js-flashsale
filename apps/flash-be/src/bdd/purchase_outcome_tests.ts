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

async function openSale(world: World) {
	await world.addSale({
		stock: 10,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

const SALE =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/purchase/outcome.feature")),
	({ Scenario }) => {
		Scenario("A buyer sees the purchase", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(SALE, async () => openSale(world));

			And("{string} has been admitted", async (_ctx, user: string) => {
				await world.admitted(user);
			});

			And("{string} has reserved an item", async (_ctx, user: string) => {
				await world.reserve(user);
			});

			And("{string} has confirmed the purchase", async (_ctx, user: string) => {
				await world.confirm(user);
			});

			When(
				"a client asks for the outcome of {string}",
				async (_ctx, user: string) => {
					await world.outcome(user);
				},
			);

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});

			And("the outcome state is {string}", (_ctx, state: string) => {
				expect(response(world).json().state).toBe(state);
			});

			And(
				"the purchase is the one {string} had before",
				(_ctx, user: string) => {
					expect(response(world).json().purchaseId).toBe(
						world.purchases.get(user)?.purchaseId,
					);
				},
			);
		});

		Scenario(
			"A shopper who holds an item sees the hold",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE, async () => openSale(world));

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When(
					"a client asks for the outcome of {string}",
					async (_ctx, user: string) => {
						await world.outcome(user);
					},
				);

				Then("the outcome state is {string}", (_ctx, state: string) => {
					expect(response(world).json().state).toBe(state);
				});

				And(
					"the reservation is the one {string} had before",
					(_ctx, user: string) => {
						expect(response(world).json().reservationId).toBe(
							world.holds.get(user)?.reservationId,
						);
					},
				);
			},
		);

		Scenario("A shopper with nothing sees none", ({ Given, When, Then }) => {
			const world = newWorld();

			Given(SALE, async () => openSale(world));

			When(
				"a client asks for the outcome of {string}",
				async (_ctx, user: string) => {
					await world.outcome(user);
				},
			);

			Then("the outcome state is {string}", (_ctx, state: string) => {
				expect(response(world).json().state).toBe(state);
			});
		});

		Scenario(
			"An expired hold is no longer shown",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE, async () => openSale(world));

				And(
					"the hold time of the sale is {int} second",
					async (_ctx, seconds: number) => {
						await world.setHoldSeconds(seconds);
					},
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				And(
					"a client asks for the outcome of {string}",
					async (_ctx, user: string) => {
						await world.outcome(user);
					},
				);

				Then("the outcome state is {string}", (_ctx, state: string) => {
					expect(response(world).json().state).toBe(state);
				});
			},
		);

		Scenario(
			"The outcome of an unknown sale is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given("no sale exists", () => {});

				When(
					"a client asks for the outcome of {string} in the sale with id {string}",
					async (_ctx, user: string, saleId: string) => {
						await world.outcome(user, saleId);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().errorCode).toBe(error);
				});
			},
		);
	},
);
