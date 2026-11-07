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
);

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

const newWorld = () => integrationOperatingWorld(db, app);

type World = ReturnType<typeof newWorld>;

// Steps that several scenarios share, written once.
const SALE_OPENING =
	"a sale was created with stock {int}, opening in {int} minutes for {int} minutes";
const SALE_OPENED =
	"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes";
const ANOTHER_SALE =
	"another sale was created with stock {int}, opening in {int} minutes for {int} minutes";
const STOCK_LEFT = "the sale has stock {int} with {int} items remaining";

const openingSale =
	(world: World) =>
	async (_ctx: unknown, stock: number, startsIn: number, minutes: number) => {
		expect((await world.createSale(stock, startsIn, minutes)).statusCode).toBe(
			201,
		);
	};
const openedSale =
	(world: World) =>
	async (_ctx: unknown, stock: number, ago: number, minutes: number) => {
		expect((await world.createSale(stock, -ago, minutes)).statusCode).toBe(201);
	};
const stockLeft =
	(world: World) => async (_ctx: unknown, stock: number, remaining: number) => {
		expect((await world.readSale()).json()).toMatchObject({ stock, remaining });
	};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/operating.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

		Scenario(
			"An operator changes a sale that has not started",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));

				When(
					"the operator changes that sale to stock {int} and a hold time of {int} seconds",
					async (_ctx, stock: number, hold: number) => {
						response = await world.operate(
							`changes that sale to stock ${stock} and a hold time of ${hold} seconds`,
							"operator",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(STOCK_LEFT, stockLeft(world));

				And(
					"the operator sees a hold time of {int} seconds on that sale",
					async (_ctx, seconds: number) => {
						const listed: Array<{ id: string; holdSeconds: number }> = (
							await world.listSales()
						).json().sales;
						expect(
							listed.find((sale) => sale.id === world.saleId)?.holdSeconds,
						).toBe(seconds);
					},
				);
			},
		);

		Scenario(
			"A sale that has started can get more stock",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENED, openedSale(world));

				When(
					"the operator changes that sale to stock {int}",
					async (_ctx, stock: number) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							"operator",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(STOCK_LEFT, stockLeft(world));
			},
		);

		ScenarioOutline(
			"A sale that has started keeps its start and its stock",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENED, openedSale(world));

				When("the operator <change>", async () => {
					response = await world.operate(String(examples.change), "operator");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(STOCK_LEFT, stockLeft(world));
			},
		);

		Scenario(
			"A sale that is over cannot be changed",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENED, openedSale(world));

				When(
					"the operator changes that sale to stock {int}",
					async (_ctx, stock: number) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							"operator",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"A change that would overlap another sale is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));
				And(ANOTHER_SALE, openingSale(world));

				When(
					"the operator moves that sale to open in {int} minutes for {int} minutes",
					async (_ctx, startsIn: number, minutes: number) => {
						response = await world.operate(
							`moves that sale to open in ${startsIn} minutes for ${minutes} minutes`,
							"operator",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"A change that makes the sale unusable is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));

				When(
					"the operator changes that sale to stock {int}",
					async (_ctx, stock: number) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							"operator",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(STOCK_LEFT, stockLeft(world));
			},
		);

		Scenario(
			"An operator removes a sale that nobody bought from",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));

				When("the operator removes that sale", async () => {
					response = await world.operate("removes that sale", "operator");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the number of sales is {int}", async (_ctx, count: number) => {
					expect(await world.salesCount()).toBe(count);
				});
			},
		);

		Scenario(
			"A removed sale stays as a row marked deleted by the operator",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));

				When("the operator removes that sale", async () => {
					response = await world.operate("removes that sale", "operator");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("that sale is not listed", async () => {
					const listed: Array<{ id: string }> = (await world.listSales()).json()
						.sales;
					expect(listed.map((sale) => sale.id)).not.toContain(world.saleId);
				});

				And(
					"that sale is kept and marked as deleted by the operator",
					async () => {
						const operatorId = await world.operatorId();
						expect(operatorId).toBeDefined();
						expect(await world.deletedBy(world.saleId)).toBe(operatorId);
					},
				);
			},
		);

		Scenario(
			"A sale with a purchase cannot be removed",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENED, openedSale(world));

				And("an item of that sale was bought", async () => {
					await world.buyItem();
				});

				When("the operator removes that sale", async () => {
					response = await world.operate("removes that sale", "operator");
				});

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
			"An operator lists every sale, the one that opens last first",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));
				And(ANOTHER_SALE, openingSale(world));

				When("the operator lists the sales", async () => {
					response = await world.operate("lists the sales", "operator");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(
					"the listed sales have the stocks {int} and {int}, in that order",
					(_ctx, first: number, second: number) => {
						const stocks = response
							.json()
							.sales.map((sale: { stock: number }) => sale.stock);
						expect(stocks).toEqual([first, second]);
					},
				);
			},
		);

		ScenarioOutline(
			"Changing, removing and listing need a login",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));

				When("someone who is not logged in <request>", async () => {
					response = await world.operate(String(examples.request), "nobody");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(STOCK_LEFT, stockLeft(world));
			},
		);

		ScenarioOutline(
			"Changing, removing and listing are for operators only",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("an operator is logged in", () => world.loginOperator());
				And(SALE_OPENING, openingSale(world));
				And("a shopper is logged in", () => world.loginShopper("ana"));

				When("the shopper <request>", async () => {
					response = await world.operate(String(examples.request), "shopper");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(STOCK_LEFT, stockLeft(world));
			},
		);
	},
);
