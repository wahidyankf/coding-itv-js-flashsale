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

const SALE = (stock: number) =>
	`a sale with stock ${stock} and 0 sold that opens 1 hour ago and closes in 1 hour`;

describeFeature(
	await loadFeature(
		specFile("flash/be/behaviours/purchase/confirming.feature"),
	),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(() => {
			real.resetSettings();
		});

		Scenario(
			"A shopper pays for the held item",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When("{string} confirms the purchase", async (_ctx, user: string) => {
					await world.confirm(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the user is {string}", (_ctx, user: string) => {
					expect(response(world).json().userId).toBe(user);
				});

				And("a purchase id is issued", () => {
					expect(response(world).json().purchaseId).toMatch(/^[0-9a-f-]{36}$/);
				});

				And("{int} items remain", async (_ctx, remaining: number) => {
					expect((await world.saleView()).remaining).toBe(remaining);
				});
			},
		);

		Scenario(
			"Confirming again returns the same purchase",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

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

				When("{string} confirms the purchase", async (_ctx, user: string) => {
					await world.confirm(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And(
					"the purchase is the one {string} had before",
					(_ctx, user: string) => {
						expect(response(world).json().purchaseId).toBe(
							world.purchases.get(user)?.purchaseId,
						);
					},
				);

				And("{int} items remain", async (_ctx, remaining: number) => {
					expect((await world.saleView()).remaining).toBe(remaining);
				});
			},
		);

		Scenario(
			"A buyer cannot reserve a second item",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

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
			"A reservation id that does not exist is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

				When(
					"{string} confirms the purchase with the reservation id {string}",
					async (_ctx, user: string, reservationId: string) => {
						await world.confirm(user, { reservationId });
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
			"A reservation id that is not an id is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

				When(
					"{string} confirms the purchase with the reservation id {string}",
					async (_ctx, user: string, reservationId: string) => {
						await world.confirm(user, { reservationId });
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
			"Somebody else's reservation cannot be confirmed",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When(
					"{string} confirms the purchase with the reservation of {string}",
					async (_ctx, user: string, owner: string) => {
						await world.confirm(user, { owner });
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
			"A hold that has expired cannot be confirmed",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(1), async () => openSale(world, 1));

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

				And("{string} confirms the purchase", async (_ctx, user: string) => {
					await world.confirm(user);
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
			"A declined payment keeps the hold",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(10), async () => openSale(world));

				And("the payment provider declines every payment", async () => {
					await world.setPaymentDeclines();
				});

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When("{string} confirms the purchase", async (_ctx, user: string) => {
					await world.confirm(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});

				And("{string} still holds the item", async (_ctx, user: string) => {
					expect((await world.outcome(user)).json().state).toBe("holding");
				});

				And("{int} items remain", async (_ctx, remaining: number) => {
					expect((await world.saleView()).remaining).toBe(remaining);
				});
			},
		);

		Scenario(
			"A payment that finishes after the item is gone is refunded",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE(1), async () => openSale(world, 1));

				And(
					"the hold time of the sale is {int} second",
					async (_ctx, seconds: number) => {
						await world.setHoldSeconds(seconds);
					},
				);

				And(
					"the payment provider takes {int} seconds",
					async (_ctx, seconds: number) => {
						await world.setPaymentDuration(seconds);
					},
				);

				And("{string} has been admitted", async (_ctx, user: string) => {
					await world.admitted(user);
				});

				And("{string} has reserved an item", async (_ctx, user: string) => {
					await world.reserve(user);
				});

				When(
					"{string} starts to confirm the purchase",
					async (_ctx, user: string) => {
						await world.startConfirm(user);
					},
				);

				And("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				And("{string} buys the last item", async (_ctx, user: string) => {
					await world.sellLastItemTo(user);
				});

				And("the confirmation finishes", async () => {
					await world.finishConfirm();
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});

				And(
					"the payment of {string} is refunded",
					async (_ctx, user: string) => {
						expect(await world.wasRefunded(user)).toBe(true);
					},
				);

				And("{string} has no purchase", async (_ctx, user: string) => {
					expect((await world.outcome(user)).json().state).toBe("none");
				});
			},
		);

		Scenario(
			"Many buyers confirming at once sell exactly the stock",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				const users = Array.from({ length: 30 }, (_, i) => `shopper${i}`);
				let replies: Response[] = [];

				Given(SALE(10), async () => openSale(world));

				And(
					"{int} shoppers have been admitted",
					async (_ctx, count: number) => {
						await world.admitMany(users.slice(0, count));
					},
				);

				And("all {int} shoppers have tried to reserve an item", async () => {
					await world.reserveAll(users);
				});

				When(
					"every shopper who holds an item confirms the purchase at the same time",
					async () => {
						replies = await world.confirmAllHolders(users);
					},
				);

				Then("{int} purchases are made", (_ctx, count: number) => {
					expect(replies.filter((r) => r.statusCode === 201)).toHaveLength(
						count,
					);
				});

				And("{int} items remain", async (_ctx, remaining: number) => {
					expect((await world.saleView()).remaining).toBe(remaining);
				});

				And("the sale status is {string}", async (_ctx, status: string) => {
					expect((await world.saleView()).status).toBe(status);
				});
			},
		);
	},
);
