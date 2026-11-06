import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { specFile } from "./support/paths.js";
import { queueWorld } from "./support/queue-world.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date("2026-06-01T12:00:00Z");

// A scenario body runs once when the tests are collected, and each step then runs as its own test. So the world is
// built per scenario and never closed between steps; app.inject needs no open port.
function newWorld() {
	return queueWorld(NOW);
}

function response(world: ReturnType<typeof queueWorld>) {
	if (!world.response) throw new Error("no request was sent");
	return world.response;
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/joining.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"Joining the queue returns a ticket and a place",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await world.addSale({
							startsAt: relativeTime("1 hour ago", NOW),
							endsAt: relativeTime("in 1 hour", NOW),
						});
					},
				);

				When("{string} joins the queue", async (_ctx, user: string) => {
					await world.join(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the user is {string}", (_ctx, user: string) => {
					expect(response(world).json().userId).toBe(user);
				});

				And("a ticket is issued", () => {
					expect(response(world).json().ticket).toMatch(/^[\w-]{20,}$/);
				});

				And("the place in line is {int}", (_ctx, place: number) => {
					expect(response(world).json().place).toBe(place);
				});
			},
		);

		Scenario(
			"Shoppers are placed in the order they join",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await world.addSale({
							startsAt: relativeTime("1 hour ago", NOW),
							endsAt: relativeTime("in 1 hour", NOW),
						});
					},
				);

				// Steps that repeat a pattern are bound by their exact text, so each one finds its own line.
				When('"ana" joins the queue', async () => {
					await world.join("ana");
				});

				And('"ben" joins the queue', async () => {
					await world.join("ben");
				});

				And('"cai" joins the queue', async () => {
					await world.join("cai");
				});

				Then('the place in line of "ana" is 1', async () => {
					expect(
						(await world.check("ana", world.tickets.get("ana"))).json().place,
					).toBe(1);
				});

				And('the place in line of "ben" is 2', async () => {
					expect(
						(await world.check("ben", world.tickets.get("ben"))).json().place,
					).toBe(2);
				});

				And('the place in line of "cai" is 3', async () => {
					expect(
						(await world.check("cai", world.tickets.get("cai"))).json().place,
					).toBe(3);
				});
			},
		);

		Scenario(
			"Joining twice keeps the place and the ticket",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await world.addSale({
							startsAt: relativeTime("1 hour ago", NOW),
							endsAt: relativeTime("in 1 hour", NOW),
						});
					},
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				And('"ben" has joined the queue', async () => {
					await world.join("ben");
				});

				When('"ana" joins the queue again', async () => {
					await world.join("ana");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the place in line is {int}", (_ctx, place: number) => {
					expect(response(world).json().place).toBe(place);
				});

				And(
					"the ticket is the one {string} had before",
					(_ctx, user: string) => {
						expect(response(world).json().ticket).toBe(world.tickets.get(user));
					},
				);
			},
		);

		Scenario("A user id is trimmed and lowercased", ({ Given, When, Then }) => {
			const world = newWorld();

			Given(
				"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
				async () => {
					await world.addSale({
						startsAt: relativeTime("1 hour ago", NOW),
						endsAt: relativeTime("in 1 hour", NOW),
					});
				},
			);

			When("{string} joins the queue", async (_ctx, user: string) => {
				await world.join(user);
			});

			Then("the user is {string}", (_ctx, user: string) => {
				expect(response(world).json().userId).toBe(user);
			});
		});

		ScenarioOutline(
			"A sale that cannot sell any more does not take new shoppers",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and <sold> sold that opens 2 hours ago and closes <closes>",
					async () => {
						await world.addSale({
							sold: Number(examples.sold),
							startsAt: relativeTime("2 hours ago", NOW),
							endsAt: relativeTime(String(examples.closes), NOW),
						});
					},
				);

				When("{string} joins the queue", async (_ctx, user: string) => {
					await world.join(user);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And('the error is "<error>"', () => {
					expect(response(world).json().errorCode).toBe(examples.error);
				});
			},
		);

		ScenarioOutline(
			"A user id that cannot be used is refused",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();

				Given(
					"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
					async () => {
						await world.addSale({
							startsAt: relativeTime("1 hour ago", NOW),
							endsAt: relativeTime("in 1 hour", NOW),
						});
					},
				);

				When('the user id "<userId>" joins the queue', async () => {
					await world.join(String(examples.userId));
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"Joining the queue of an unknown sale is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given("no sale exists", () => {});

				When(
					"{string} joins the queue of the sale with id {string}",
					async (_ctx, user: string, saleId: string) => {
						await world.join(user, saleId);
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
