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

async function openSale(world: World, stock = 10) {
	await world.addSale({
		stock,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/reservation/reserving.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"An admitted shopper reserves an item",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the user is {string}", (_ctx, user: string) => {
					expect(response(world).json().userId).toBe(user);
				});

				And("a reservation id is issued", () => {
					expect(response(world).json().reservationId).toMatch(
						/^[0-9a-f-]{36}$/,
					);
				});

				And("the hold ends in {int} seconds", (_ctx, seconds: number) => {
					const ends = new Date(response(world).json().expiresAt).getTime();
					expect(Math.abs(ends - Date.now() - seconds * 1000)).toBeLessThan(
						5000,
					);
				});
			},
		);

		Scenario(
			"Reserving again returns the same hold",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

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

		Scenario(
			"A shopper who is still waiting cannot reserve",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has joined the queue", async (_ctx, user: string) => {
					await world.join(user);
				});

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);

		Scenario(
			"A shopper with a wrong ticket cannot reserve",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				When(
					"{string} reserves an item with a wrong ticket",
					async (_ctx, user: string) => {
						await world.reserve(user, { ticket: "not-the-ticket" });
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);

		Scenario(
			"A buyer is told so when the queue was lost",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				And(
					"{string} has confirmed the purchase",
					async (_ctx, user: string) => {
						await world.confirm(user);
					},
				);

				And("the queue is lost", async () => {
					await world.loseQueue();
				});

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);

		ScenarioOutline(
			"A sale that is not selling does not take reservations",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and <sold> sold that opens <opens> and closes <closes>",
					async () => {
						await world.addSale({
							stock: 10,
							sold: Number(examples.sold),
							startsAt: relativeTime(String(examples.opens), NOW),
							endsAt: relativeTime(String(examples.closes), NOW),
						});
					},
				);

				When("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And('the error is "<error>"', () => {
					expect(response(world).json().error).toBe(examples.error);
				});
			},
		);

		Scenario(
			"Reserving in an unknown sale is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given("no sale exists", () => {});

				When(
					"{string} reserves an item in the sale with id {string}",
					async (_ctx, user: string, saleId: string) => {
						await world.reserve(user, { saleId });
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);

		Scenario("Holds count against the stock", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(
				"a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour",
				async () => openSale(world, 2),
			);

			And('"ana" has been admitted', async () => {
				await world.admitted("ana");
			});

			And('"ben" has been admitted', async () => {
				await world.admitted("ben");
			});

			And('"cai" has been admitted', async () => {
				await world.admitted("cai");
			});

			And('"ana" has reserved an item', async () => {
				await world.reserve("ana");
			});

			And('"ben" has reserved an item', async () => {
				await world.reserve("ben");
			});

			When("{string} reserves an item", async (_ctx, user: string) => {
				await world.reserve(user);
			});

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});

			And("the error is {string}", (_ctx, error: string) => {
				expect(response(world).json().error).toBe(error);
			});
		});

		Scenario(
			"An expired hold gives the item back",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world, 1),
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

				When("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				And("{string} reserves an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});
			},
		);

		Scenario(
			"Many shoppers reserving at once never hold more than the stock",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				const users = Array.from({ length: 30 }, (_, i) => `shopper${i}`);
				let replies: Response[] = [];

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world),
				);

				And(
					"{int} shoppers have been admitted",
					async (_ctx, count: number) => {
						await world.admitMany(users.slice(0, count));
					},
				);

				When(
					"all {int} shoppers reserve an item at the same time",
					async () => {
						replies = await world.reserveAll(users);
					},
				);

				Then("{int} reservations are granted", (_ctx, count: number) => {
					expect(replies.filter((r) => r.statusCode === 201)).toHaveLength(
						count,
					);
				});

				And(
					"{int} shoppers are told the item is sold out",
					(_ctx, count: number) => {
						const soldOut = replies.filter(
							(r) => r.statusCode === 409 && r.json().error === "sold_out",
						);
						expect(soldOut).toHaveLength(count);
					},
				);
			},
		);

		Scenario(
			"A failed write to Postgres gives the item back",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => openSale(world, 1),
				);

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ben" has been admitted', async () => {
					await world.admitted("ben");
				});

				And("Postgres refuses to save reservations", async () => {
					await world.breakWrites();
				});

				When('"ana" reserves an item and the write fails', async () => {
					expect((await world.reserve("ana")).statusCode).toBe(500);
				});

				And("Postgres saves reservations again", async () => {
					await world.fixWrites();
				});

				And('"ben" reserves an item', async () => {
					await world.reserve("ben");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});
			},
		);
	},
);
