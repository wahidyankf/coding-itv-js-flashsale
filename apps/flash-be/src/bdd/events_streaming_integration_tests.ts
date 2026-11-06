import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll, expect } from "vitest";
import { specFile } from "./support/paths.js";
import { openQueueIntegration } from "./support/queue-integration.js";
import type { ShopScenario } from "./support/queue-world.js";
import { resetSales } from "./support/seed.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date();

// The run database is migrated once by the global setup. Each scenario seeds its own sale.
const real = await openQueueIntegration();
afterAll(real.close);

// A scenario body runs once when the tests are collected, and each step then runs as its own test.
function newWorld() {
	return real.scenario();
}

type World = ShopScenario;

function watcher(world: World) {
	if (!world.watcher) throw new Error("nobody is watching");
	return world.watcher;
}

async function addSale(
	world: World,
	sold: number,
	opens: string,
	closes: string,
) {
	await world.addSale({
		stock: 10,
		sold,
		startsAt: relativeTime(opens, NOW),
		endsAt: relativeTime(closes, NOW),
	});
}

const OPEN_WITH_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";
const OPEN_WITH_0 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";
const LATER_WITH_0 =
	"a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/events/streaming.feature")),
	({ Scenario, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			real.resetSettings();
			await resetSales(real.db);
		});

		Scenario(
			"A client watching the sale gets its status at once",
			({ Given, When, Then }) => {
				const world = newWorld();

				Given(OPEN_WITH_3, async () =>
					addSale(world, 3, "1 hour ago", "in 1 hour"),
				);

				When("a client watches the sale", async () => {
					await world.watchSale();
				});

				Then(
					"the first event is {string} with status {string} and {int} items remaining",
					async (_ctx, event: string, status: string, left: number) => {
						const first = await watcher(world).next();
						expect(first.event).toBe(event);
						expect(first.data.status).toBe(status);
						expect(first.data.remaining).toBe(left);
					},
				);
			},
		);

		Scenario(
			"A change in the sale is pushed to the client",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(OPEN_WITH_3, async () =>
					addSale(world, 3, "1 hour ago", "in 1 hour"),
				);

				And("a client is watching the sale", async () => {
					await world.watchSale();
					await watcher(world).next();
				});

				When("the sold count changes to {int}", async (_ctx, sold: number) => {
					await world.setSold(sold);
				});

				Then(
					"the next event is {string} with status {string} and {int} items remaining",
					async (_ctx, event: string, status: string, left: number) => {
						const next = await watcher(world).next();
						expect(next.event).toBe(event);
						expect(next.data.status).toBe(status);
						expect(next.data.remaining).toBe(left);
					},
				);
			},
		);

		Scenario(
			"Watching an unknown sale is refused",
			({ Given, When, Then, And }) => {
				const world = newWorld();

				Given("no sale exists", () => {});

				When(
					"a client watches the sale with id {string}",
					async (_ctx, id: string) => {
						await world.watchSale(id);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(watcher(world).status).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(watcher(world).body.errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"A waiting shopper hears when they are admitted",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(LATER_WITH_0, async () =>
					addSale(world, 0, "in 1 hour", "in 2 hours"),
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				And('"ana" is watching her place', async () => {
					await world.watchPlace("ana");
					await watcher(world).next();
				});

				When("the sale opens", async () => {
					await world.openSale();
				});

				Then(
					"the next event is {string} with the state {string}",
					async (_ctx, event: string, state: string) => {
						const next = await watcher(world).next();
						expect(next.event).toBe(event);
						expect(next.data.state).toBe(state);
					},
				);
			},
		);

		Scenario(
			"A shopper watching their place sees it first",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(LATER_WITH_0, async () =>
					addSale(world, 0, "in 1 hour", "in 2 hours"),
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				When('"ana" watches her place', async () => {
					await world.watchPlace("ana");
				});

				Then(
					"the first event is {string} with the state {string} at place {int}",
					async (_ctx, event: string, state: string, place: number) => {
						const first = await watcher(world).next();
						expect(first.event).toBe(event);
						expect(first.data.state).toBe(state);
						expect(first.data.place).toBe(place);
					},
				);
			},
		);

		Scenario(
			"Watching a place with a wrong ticket is refused",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(OPEN_WITH_0, async () =>
					addSale(world, 0, "1 hour ago", "in 1 hour"),
				);

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				When('"ana" watches her place with a wrong ticket', async () => {
					await world.watchPlace("ana", "not-the-ticket");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(watcher(world).status).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(watcher(world).body.errorCode).toBe(error);
				});
			},
		);
	},
);
