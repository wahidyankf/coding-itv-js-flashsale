import { randomUUID } from "node:crypto";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import type { Response } from "./support/operating.js";
import { integrationOperatingWorld } from "./support/operating-integration.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
// No cache, so the current sale is read as it is.
const app = buildApp(
	dependenciesFrom(db, redis, { ...config, saleCacheMs: 0 }),
	{ cookieSecure: false },
);

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

const newWorld = () => integrationOperatingWorld(db, app);

const startOf = "opening in {int} minutes for {int} minutes";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/admin.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

		Scenario(
			"An operator creates a sale and shoppers see it",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				When(
					`the operator creates a sale with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(stock, startsIn, minutes);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(
					"the new sale is {string} with {int} items remaining",
					(_ctx, status: string, remaining: number) => {
						expect(response.json()).toMatchObject({ status, remaining });
					},
				);

				And("the current sale is the new sale", async () => {
					expect((await world.readCurrentSale()).json().id).toBe(
						response.json().id,
					);
				});
			},
		);

		Scenario(
			"A request from someone who is not logged in is refused",
			({ When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				When(
					`someone who is not logged in creates a sale with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(
							stock,
							startsIn,
							minutes,
							"nobody",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario("A shopper cannot create a sale", ({ Given, When, Then, And }) => {
			const world = newWorld();
			let response: Response;

			Given("a shopper is logged in", () => world.loginShopper("ana"));

			When(
				`the shopper creates a sale with stock {int}, ${startOf}`,
				async (_ctx, stock: number, startsIn: number, minutes: number) => {
					response = await world.createSale(
						stock,
						startsIn,
						minutes,
						"shopper",
					);
				},
			);

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response.statusCode).toBe(status);
			});

			And("the error is {string}", (_ctx, error: string) => {
				expect(response.json().errorCode).toBe(error);
			});

			And("the number of sales is {int}", async (_ctx, count: number) => {
				expect(await world.salesCount()).toBe(count);
			});
		});

		ScenarioOutline(
			"A sale that cannot work is refused",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				When(
					"the operator creates a sale with stock <stock>, opening in 10 minutes for <duration> minutes",
					async () => {
						response = await world.createSale(
							Number(examples.stock),
							10,
							Number(examples.duration),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"A sale whose window overlaps another sale is refused",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				And(
					`a sale was created with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					`the operator creates a sale with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(stock, startsIn, minutes);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"A sale that opens when another one closes is accepted",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				And(
					`a sale was created with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					`the operator creates a sale with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(stock, startsIn, minutes);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"Operators who create the same window at once get one sale",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let responses: Response[] = [];

				Given("an operator is logged in", () => world.loginOperator());

				When(
					`{int} operators create a sale with stock {int}, ${startOf}, at the same moment`,
					async (
						_ctx,
						operators: number,
						stock: number,
						startsIn: number,
						minutes: number,
					) => {
						responses = await Promise.all(
							Array.from({ length: operators }, () =>
								world.createSale(stock, startsIn, minutes),
							),
						);
					},
				);

				Then(
					"exactly {int} of them gets status {int}",
					(_ctx, count: number, status: number) => {
						expect(
							responses.filter((r) => r.statusCode === status),
						).toHaveLength(count);
					},
				);

				And(
					"the others get status {int} with the error {string}",
					(_ctx, status: number, error: string) => {
						const others = responses.filter((r) => r.statusCode !== 201);
						expect(others.length).toBeGreaterThan(0);
						for (const other of others) {
							expect(other.statusCode).toBe(status);
							expect(other.json().errorCode).toBe(error);
						}
					},
				);

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"An operator creates a sale for a product that exists",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				And("a product named {string} exists", async (_ctx, name: string) => {
					await world.makeProduct(name);
				});

				When(
					`the operator creates a sale of that product with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(stock, startsIn, minutes);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the new sale sells that product", async () => {
					expect(response.json().productId).toBe(world.lastProductId);
					expect(await world.productsOfSales()).toEqual([world.lastProductId]);
				});
			},
		);

		Scenario(
			"A sale for a product that does not exist is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				When(
					`the operator creates a sale of a product that does not exist with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSaleFor(
							stock,
							startsIn,
							minutes,
							randomUUID(),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"Sales created without a product share one product",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());

				And(
					`a sale was created with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					`the operator creates a sale with stock {int}, ${startOf}`,
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.createSale(stock, startsIn, minutes);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});

				And("the sales sell {int} product", async (_ctx, products: number) => {
					expect(await world.productsOfSales()).toHaveLength(products);
				});
			},
		);
	},
);
