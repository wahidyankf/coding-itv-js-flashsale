import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { specFile } from "./support/paths.js";
import { openQueueIntegration } from "./support/queue-integration.js";
import type { QueueScenario } from "./support/queue-world.js";
import { resetSales } from "./support/seed.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date();

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);

function newWorld() {
	return real.scenario();
}

function response(world: QueueScenario) {
	if (!world.response) throw new Error("no request was sent");
	return world.response;
}

async function openSale(world: QueueScenario) {
	await world.addSale({
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/admission.feature")),
	({ Scenario, BeforeEachScenario }) => {
		// The server admits the sale shoppers are shown, so sales left by an earlier scenario must not be there.
		BeforeEachScenario(async () => {
			await resetSales(real.db);
		});

		Scenario(
			"The queue admits shoppers in order at the sale's rate",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await openSale(world);
					},
				);

				And(
					"the sale admits {int} users per second",
					async (_ctx, rate: number) => {
						await world.setAdmitRate(rate);
					},
				);

				And(
					"{string}, {string} and {string} have joined the queue in that order",
					async (_ctx, first: string, second: string, third: string) => {
						for (const user of [first, second, third]) await world.join(user);
					},
				);

				When("admission runs once", async () => {
					await world.admit();
				});

				Then('"ana" is admitted', async () => {
					const reply = await world.check("ana", world.tickets.get("ana"));
					expect(reply.json().state).toBe("admitted");
				});

				And('"ben" is admitted', async () => {
					const reply = await world.check("ben", world.tickets.get("ben"));
					expect(reply.json().state).toBe("admitted");
				});

				And('"cai" is waiting at place 1', async () => {
					const reply = await world.check("cai", world.tickets.get("cai"));
					expect(reply.json()).toMatchObject({ state: "waiting", place: 1 });
				});
			},
		);

		Scenario(
			"Nobody is admitted before the sale opens",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours",
					async () => {
						await world.addSale({
							startsAt: relativeTime("in 1 hour", NOW),
							endsAt: relativeTime("in 2 hours", NOW),
						});
					},
				);

				And("{string} has joined the queue", async (_ctx, user: string) => {
					await world.join(user);
				});

				When("admission runs once", async () => {
					await world.admit();
				});

				Then('"ana" is waiting at place 1', async () => {
					const reply = await world.check("ana", world.tickets.get("ana"));
					expect(reply.json()).toMatchObject({ state: "waiting", place: 1 });
				});
			},
		);

		Scenario(
			"The queue of the running sale is admitted while a later sale is scheduled",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await openSale(world);
					},
				);

				And(
					"a later sale that opens in 2 hours and closes in 3 hours",
					async () => {
						// The scenario keeps talking about the running sale; the later one only has to exist.
						const running = world.saleId;
						await world.addSale({
							startsAt: relativeTime("in 2 hours", NOW),
							endsAt: relativeTime("in 3 hours", NOW),
						});
						world.saleId = running;
					},
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				When("admission runs once", async () => {
					await world.admit();
				});

				Then('"ana" is admitted', async () => {
					const reply = await world.check("ana", world.tickets.get("ana"));
					expect(reply.json().state).toBe("admitted");
				});
			},
		);

		Scenario(
			"A shopper reads their place with their ticket",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await openSale(world);
					},
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				And('"ben" has joined the queue', async () => {
					await world.join("ben");
				});

				When('"ben" checks the queue with their ticket', async () => {
					await world.check("ben", world.tickets.get("ben"));
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the place in line is {int}", (_ctx, place: number) => {
					expect(response(world).json().place).toBe(place);
				});
			},
		);

		Scenario("A wrong ticket is refused", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(
				"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
				async () => {
					await openSale(world);
				},
			);

			And("{string} has joined the queue", async (_ctx, user: string) => {
				await world.join(user);
			});

			When('"ana" checks the queue with a wrong ticket', async () => {
				await world.check("ana", "not-the-ticket");
			});

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});

			And("the error is {string}", (_ctx, error: string) => {
				expect(response(world).json().errorCode).toBe(error);
			});
		});

		Scenario(
			"A shopper whose place was lost is told to join again",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await openSale(world);
					},
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				And("the queue is lost", async () => {
					await world.loseQueue();
				});

				When('"ana" checks the queue with their ticket', async () => {
					await world.check("ana", world.tickets.get("ana"));
				});

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
