import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

const MINUTE_MS = 60_000;

// The run database is migrated once by the global setup. Each scenario empties the sales table first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
	await redis.close();
	await db.destroy();
});

// One scenario: an app over the real database, with the token the operator was given.
function scenario() {
	let token: string | undefined;
	let app: FastifyInstance | undefined;
	const appNow = (): FastifyInstance => {
		if (app) return app;
		// No cache, so the current sale is read as it is.
		app = buildApp(
			dependenciesFrom(db, redis, {
				...config,
				saleCacheMs: 0,
				adminToken: token,
			}),
		);
		apps.push(app);
		return app;
	};
	return {
		useToken: (value: string | undefined) => {
			token = value;
		},
		get token() {
			return token;
		},
		salesCount: async (): Promise<number> =>
			(await db.selectFrom("sales").select("id").execute()).length,
		create: (
			stock: number,
			startsIn: number,
			minutes: number,
			authorization: string | undefined,
		): Promise<Response> => {
			const startsAt = new Date(Date.now() + startsIn * MINUTE_MS);
			return appNow().inject({
				method: "POST",
				url: "/admin/sales",
				headers: {
					"content-type": "application/json",
					...(authorization === undefined ? {} : { authorization }),
				},
				payload: JSON.stringify({
					stock,
					startsAt: startsAt.toISOString(),
					endsAt: new Date(
						startsAt.getTime() + minutes * MINUTE_MS,
					).toISOString(),
				}),
			});
		},
		current: () => appNow().inject({ method: "GET", url: "/sales/current" }),
	};
}

const bearer = (token: string) => `Bearer ${token}`;

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/admin.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

		Scenario(
			"An operator creates a sale and shoppers see it",
			({ Given, When, Then, And }) => {
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, using the token {string}",
					async (
						_ctx,
						stock: number,
						startsIn: number,
						minutes: number,
						token: string,
					) => {
						response = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(token),
						);
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
					expect((await world.current()).json().id).toBe(response.json().id);
				});
			},
		);

		Scenario(
			"A request without a token is refused",
			({ Given, When, Then, And }) => {
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, without a token",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						response = await world.create(stock, startsIn, minutes, undefined);
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
			"A request with the wrong token is refused",
			({ Given, When, Then, And }) => {
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, using the token {string}",
					async (
						_ctx,
						stock: number,
						startsIn: number,
						minutes: number,
						token: string,
					) => {
						response = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(token),
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
			"The admin route does not exist when no token is set",
			({ Given, When, Then, And }) => {
				const world = scenario();
				let response: Response;

				Given("no admin token is set", () => {
					world.useToken(undefined);
				});

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, using the token {string}",
					async (
						_ctx,
						stock: number,
						startsIn: number,
						minutes: number,
						token: string,
					) => {
						response = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(token),
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

		ScenarioOutline(
			"A sale that cannot work is refused",
			({ Given, When, Then, And }, examples) => {
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				When(
					'the operator creates a sale with stock <stock>, opening in 10 minutes for <duration> minutes, using the token "operator-secret-0001"',
					async () => {
						response = await world.create(
							Number(examples.stock),
							10,
							Number(examples.duration),
							bearer("operator-secret-0001"),
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
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						const first = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(world.token ?? ""),
						);
						expect(first.statusCode).toBe(201);
					},
				);

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, using the token {string}",
					async (
						_ctx,
						stock: number,
						startsIn: number,
						minutes: number,
						token: string,
					) => {
						response = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(token),
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
			"A sale that opens when another one closes is accepted",
			({ Given, And, When, Then }) => {
				const world = scenario();
				let response: Response;

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				And(
					"a sale was created with stock {int}, opening in {int} minutes for {int} minutes",
					async (_ctx, stock: number, startsIn: number, minutes: number) => {
						await world.create(
							stock,
							startsIn,
							minutes,
							bearer(world.token ?? ""),
						);
					},
				);

				When(
					"the operator creates a sale with stock {int}, opening in {int} minutes for {int} minutes, using the token {string}",
					async (
						_ctx,
						stock: number,
						startsIn: number,
						minutes: number,
						token: string,
					) => {
						response = await world.create(
							stock,
							startsIn,
							minutes,
							bearer(token),
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
			"Operators who create the same window at once get one sale",
			({ Given, When, Then, And }) => {
				const world = scenario();
				let responses: Response[] = [];

				Given("the admin token is {string}", (_ctx, token: string) => {
					world.useToken(token);
				});

				When(
					"{int} operators create a sale with stock {int}, opening in {int} minutes for {int} minutes, at the same moment",
					async (
						_ctx,
						operators: number,
						stock: number,
						startsIn: number,
						minutes: number,
					) => {
						responses = await Promise.all(
							Array.from({ length: operators }, () =>
								world.create(
									stock,
									startsIn,
									minutes,
									bearer(world.token ?? ""),
								),
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
	},
);
