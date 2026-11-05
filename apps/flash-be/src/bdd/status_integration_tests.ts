import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { specFile } from "./support/paths.js";
import { insertSale, resetSales } from "./support/seed.js";
import { relativeTime } from "./support/time.js";

type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const app = buildApp(dependenciesFrom(db, redis, config));

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

		ScenarioOutline(
			"The sale reports its status from its window and its stock",
			({ Given, When, Then, And }, examples) => {
				let saleId: string;
				let response: Response;

				Given(
					"a sale with stock <stock> and <sold> sold that opens <opens> and closes <closes>",
					async () => {
						const now = new Date();
						saleId = await insertSale(db, {
							stock: Number(examples.stock),
							sold: Number(examples.sold),
							startsAt: relativeTime(String(examples.opens), now),
							endsAt: relativeTime(String(examples.closes), now),
						});
					},
				);

				When("a client asks for that sale", async () => {
					response = await app.inject({
						method: "GET",
						url: `/sales/${saleId}`,
					});
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And('the sale status is "<status>"', () => {
					expect(response.json().status).toBe(examples.status);
				});

				And("<remaining> items remain", () => {
					expect(response.json().remaining).toBe(Number(examples.remaining));
				});
			},
		);

		Scenario(
			"The current sale is the one that opens last",
			({ Given, And, When, Then }) => {
				let response: Response;
				const seed = async (name: string, opened: string) => {
					const startsAt = relativeTime(opened, new Date());
					await insertSale(db, {
						name,
						startsAt,
						endsAt: new Date(startsAt.getTime() + 6 * 3_600_000),
					});
				};

				Given(
					"a sale named {string} that opened {any}",
					async (_ctx, name: string, opened: string) => seed(name, opened),
				);

				And(
					"a sale named {string} that opened {any}",
					async (_ctx, name: string, opened: string) => seed(name, opened),
				);

				When("a client asks for the current sale", async () => {
					response = await app.inject({ method: "GET", url: "/sales/current" });
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And("the sale name is {string}", (_ctx, name: string) => {
					expect(response.json().name).toBe(name);
				});
			},
		);

		Scenario(
			"There is no current sale before one is created",
			({ Given, When, Then, And }) => {
				let response: Response;

				Given("no sale exists", async () => {
					await resetSales(db);
				});

				When("a client asks for the current sale", async () => {
					response = await app.inject({ method: "GET", url: "/sales/current" });
				});

				Then("the response status is 404", () => {
					expect(response.statusCode).toBe(404);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().error).toBe(error);
				});
			},
		);

		ScenarioOutline(
			"An unknown sale is refused",
			({ Given, When, Then, And }, examples) => {
				let response: Response;

				Given("no sale exists", async () => {
					await resetSales(db);
				});

				When('a client asks for the sale with id "<id>"', async () => {
					response = await app.inject({
						method: "GET",
						url: `/sales/${examples.id}`,
					});
				});

				Then("the response status is 404", () => {
					expect(response.statusCode).toBe(404);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().error).toBe(error);
				});
			},
		);
	},
	{ excludeTags: ["integration-exempt"] },
);
