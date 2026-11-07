import { randomUUID } from "node:crypto";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { operatorWorld, type Response } from "./support/operating.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

const TOKEN = "operator-secret-0001";

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
// No cache, so a read shows the sale as it is.
const app = buildApp(
	dependenciesFrom(db, redis, { ...config, saleCacheMs: 0, adminToken: TOKEN }),
);

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

// One scenario over the real database. A bought item is a purchase row and one more sold.
function newWorld() {
	return operatorWorld({
		app: () => app,
		now: () => new Date(),
		buyItem: async (saleId) => {
			await db
				.insertInto("purchases")
				.values({
					sale_id: saleId,
					user_id: "ana",
					reservation_id: randomUUID(),
					payment_ref: "pay-ana",
				})
				.execute();
			await db
				.updateTable("sales")
				.set({ sold: sql`sold + 1` })
				.where("id", "=", saleId)
				.execute();
		},
		salesCount: async () =>
			(await db.selectFrom("sales").select("id").execute()).length,
	});
}

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

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator changes that sale to stock {int} and a hold time of {int} seconds, using the token {string}",
					async (_ctx, stock: number, hold: number, token: string) => {
						response = await world.operate(
							`changes that sale to stock ${stock} and a hold time of ${hold} seconds`,
							world.bearer(token),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(
					"the sale has stock {int} with {int} items remaining",
					async (_ctx, stock: number, remaining: number) => {
						expect((await world.readSale()).json()).toMatchObject({
							stock,
							remaining,
						});
					},
				);

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

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes",
					async (_ctx, stock: number, ago: number, minutes: number) => {
						expect(
							(await world.createSale(stock, -ago, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator changes that sale to stock {int}, using the token {string}",
					async (_ctx, stock: number, token: string) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							world.bearer(token),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And(
					"the sale has stock {int} with {int} items remaining",
					async (_ctx, stock: number, remaining: number) => {
						expect((await world.readSale()).json()).toMatchObject({
							stock,
							remaining,
						});
					},
				);
			},
		);

		ScenarioOutline(
			"A sale that has started keeps its start and its stock",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes",
					async (_ctx, stock: number, ago: number, minutes: number) => {
						expect(
							(await world.createSale(stock, -ago, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					'the operator <change>, using the token "operator-secret-0001"',
					async () => {
						response = await world.operate(
							String(examples.change),
							world.bearer(TOKEN),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(
					"the sale has stock {int} with {int} items remaining",
					async (_ctx, stock: number, remaining: number) => {
						expect((await world.readSale()).json()).toMatchObject({
							stock,
							remaining,
						});
					},
				);
			},
		);

		Scenario(
			"A sale that is over cannot be changed",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes",
					async (_ctx, stock: number, ago: number, minutes: number) => {
						expect(
							(await world.createSale(stock, -ago, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator changes that sale to stock {int}, using the token {string}",
					async (_ctx, stock: number, token: string) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							world.bearer(token),
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

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				And(
					"another sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator moves that sale to open in {int} minutes for {int} minutes, using the token {string}",
					async (_ctx, startsIn: number, minutes: number, token: string) => {
						response = await world.operate(
							`moves that sale to open in ${startsIn} minutes for ${minutes} minutes`,
							world.bearer(token),
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

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator changes that sale to stock {int}, using the token {string}",
					async (_ctx, stock: number, token: string) => {
						response = await world.operate(
							`changes that sale to stock ${stock}`,
							world.bearer(token),
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(
					"the sale has stock {int} with {int} items remaining",
					async (_ctx, stock: number, remaining: number) => {
						expect((await world.readSale()).json()).toMatchObject({
							stock,
							remaining,
						});
					},
				);
			},
		);

		Scenario(
			"An operator removes a sale that nobody bought from",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator removes that sale, using the token {string}",
					async (_ctx, token: string) => {
						response = await world.operate(
							"removes that sale",
							world.bearer(token),
						);
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
			"A sale with a purchase cannot be removed",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes",
					async (_ctx, stock: number, ago: number, minutes: number) => {
						expect(
							(await world.createSale(stock, -ago, minutes)).statusCode,
						).toBe(201);
					},
				);

				And("an item of that sale was bought", async () => {
					await world.buyItem();
				});

				When(
					"the operator removes that sale, using the token {string}",
					async (_ctx, token: string) => {
						response = await world.operate(
							"removes that sale",
							world.bearer(token),
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
			"An operator lists every sale, the one that opens last first",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				And(
					"another sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When(
					"the operator lists the sales, using the token {string}",
					async (_ctx, token: string) => {
						response = await world.operate(
							"lists the sales",
							world.bearer(token),
						);
					},
				);

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
			"Changing, removing and listing need the token",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						expect(
							(await world.createSale(stock, startsIn, minutes)).statusCode,
						).toBe(201);
					},
				);

				When("the operator <request>, without a token", async () => {
					response = await world.operate(String(examples.request), undefined);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response.statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});

				And(
					"the sale has stock {int} with {int} items remaining",
					async (_ctx, stock: number, remaining: number) => {
						expect((await world.readSale()).json()).toMatchObject({
							stock,
							remaining,
						});
					},
				);
			},
		);
	},
);
