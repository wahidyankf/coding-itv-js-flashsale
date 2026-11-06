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
	await loadFeature(
		specFile("flash/be/behaviours/rate-limit/limiting.feature"),
	),
	({ Scenario, ScenarioOutline }) => {
		ScenarioOutline(
			"Every write route is limited per user",
			({ Given, And, When, Then }, examples) => {
				const world = newWorld();

				Given(SALE, async () => openSale(world));

				And(
					"the limit is {int} requests per user in each {int} seconds",
					async (_ctx, requests: number, seconds: number) => {
						await world.setUserLimit(requests, seconds);
					},
				);

				When('"ana" tries to <request> 4 times', async () => {
					await world.repeat(String(examples.request), "ana", 4);
				});

				Then(
					"the first {int} requests are not limited",
					(_ctx, count: number) => {
						const first = world.replies.slice(0, count);
						expect(first.map((reply) => reply.statusCode)).not.toContain(429);
					},
				);

				And("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().errorCode).toBe(error);
				});

				And(
					"a Retry-After header of at least {int} second is given",
					(_ctx, seconds: number) => {
						expect(
							Number(response(world).headers["retry-after"]),
						).toBeGreaterThanOrEqual(seconds);
					},
				);
			},
		);

		Scenario("Another user is not affected", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(SALE, async () => openSale(world));

			And(
				"the limit is {int} requests per user in each {int} seconds",
				async (_ctx, requests: number, seconds: number) => {
					await world.setUserLimit(requests, seconds);
				},
			);

			And(
				"{string} has tried to join the queue {int} times",
				async (_ctx, user: string, times: number) => {
					await world.repeat("join the queue", user, times);
				},
			);

			When("{string} joins the queue", async (_ctx, user: string) => {
				await world.join(user);
			});

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});
		});

		Scenario(
			"A single address is limited across users",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE, async () => openSale(world));

				And(
					"the limit is {int} requests per address in each {int} seconds",
					async (_ctx, requests: number, seconds: number) => {
						await world.setAddressLimit(requests, seconds);
					},
				);

				When(
					"{int} different shoppers join the queue from one address",
					async (_ctx, count: number) => {
						await world.joinMany(count);
					},
				);

				Then("{int} requests are accepted", (_ctx, count: number) => {
					expect(
						world.replies.filter((reply) => reply.statusCode !== 429),
					).toHaveLength(count);
				});

				And("{int} requests are limited", (_ctx, count: number) => {
					expect(
						world.replies.filter((reply) => reply.statusCode === 429),
					).toHaveLength(count);
				});
			},
		);

		Scenario(
			"The count starts again in the next window",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE, async () => openSale(world));

				And(
					"the limit is {int} requests per user in each {int} seconds",
					async (_ctx, requests: number, seconds: number) => {
						await world.setUserLimit(requests, seconds);
					},
				);

				And(
					"{string} has tried to join the queue {int} times",
					async (_ctx, user: string, times: number) => {
						await world.repeat("join the queue", user, times);
					},
				);

				When("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				And("{string} joins the queue", async (_ctx, user: string) => {
					await world.join(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});
			},
		);
	},
);
