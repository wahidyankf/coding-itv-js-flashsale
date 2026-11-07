// The steps of specs/apps/flash/be/behaviours/events/streaming.feature, as both layers bind them. The events are read from
// the watcher a scenario opens, not from a reply, so these steps read the watcher. Each scenario gets the world its layer
// makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import type { EventWatcher, ShopScenario } from "./queue-scenario.js";
import { OPEN_SALE, openSale, type ShopLayer } from "./shop-steps.js";
import type { ScenarioBinder } from "./steps.js";
import { relativeTime } from "./time.js";

// The watcher the scenario opened. Reading an event before one is opened is a bug in the scenario.
function watcherOf(world: ShopScenario): EventWatcher {
	if (!world.watcher) throw new Error("nobody is watching");
	return world.watcher;
}

// Adds a sale with the given sold count, open from `opens` until `closes`, both counted from the layer's moment.
async function addSale(
	world: ShopScenario,
	now: Date,
	sold: number,
	opens: string,
	closes: string,
): Promise<void> {
	await world.addSale({
		stock: 10,
		sold,
		startsAt: relativeTime(opens, now),
		endsAt: relativeTime(closes, now),
	});
}

// The sale opening in an hour and closing in two, with nothing sold: the shopper waits for it.
const LATER_WITH_0 =
	"a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours";

function watchesAtOnce(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour",
			async () => addSale(world, layer.now, 3, "1 hour ago", "in 1 hour"),
		);

		When("a client watches the sale", async () => {
			await world.watchSale();
		});

		Then(
			"the first event is {string} with status {string} and {int} items remaining",
			async (_ctx, event: string, status: string, left: number) => {
				const first = await watcherOf(world).next();
				expect(first.event).toBe(event);
				expect(first.data.status).toBe(status);
				expect(first.data.remaining).toBe(left);
			},
		);
	};
}

function pushesChange(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour",
			async () => addSale(world, layer.now, 3, "1 hour ago", "in 1 hour"),
		);

		And("a client is watching the sale", async () => {
			await world.watchSale();
			await watcherOf(world).next();
		});

		When("the sold count changes to {int}", async (_ctx, sold: number) => {
			await world.setSold(sold);
		});

		Then(
			"the next event is {string} with status {string} and {int} items remaining",
			async (_ctx, event: string, status: string, left: number) => {
				const next = await watcherOf(world).next();
				expect(next.event).toBe(event);
				expect(next.data.status).toBe(status);
				expect(next.data.remaining).toBe(left);
			},
		);
	};
}

function refusesUnknownSale(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given("no sale exists", () => {});

		When(
			"a client watches the sale with id {string}",
			async (_ctx, id: string) => {
				await world.watchSale(id);
			},
		);

		Then("the response status is {int}", (_ctx, status: number) => {
			expect(watcherOf(world).status).toBe(status);
		});

		And("the error is {string}", (_ctx, error: string) => {
			expect(watcherOf(world).body.errorCode).toBe(error);
		});
	};
}

function hearsAdmitted(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(LATER_WITH_0, async () =>
			addSale(world, layer.now, 0, "in 1 hour", "in 2 hours"),
		);

		And('"ana" has joined the queue', async () => {
			await world.join("ana");
		});

		And('"ana" is watching her place', async () => {
			await world.watchPlace("ana");
			await watcherOf(world).next();
		});

		When("the sale opens", async () => {
			await world.openSale();
		});

		Then(
			"the next event is {string} with the state {string}",
			async (_ctx, event: string, state: string) => {
				const next = await watcherOf(world).next();
				expect(next.event).toBe(event);
				expect(next.data.state).toBe(state);
			},
		);
	};
}

function watchesPlaceFirst(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(LATER_WITH_0, async () =>
			addSale(world, layer.now, 0, "in 1 hour", "in 2 hours"),
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
				const first = await watcherOf(world).next();
				expect(first.event).toBe(event);
				expect(first.data.state).toBe(state);
				expect(first.data.place).toBe(place);
			},
		);
	};
}

function refusesWrongPlaceTicket(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And('"ana" has joined the queue', async () => {
			await world.join("ana");
		});

		When('"ana" watches her place with a wrong ticket', async () => {
			await world.watchPlace("ana", "not-the-ticket");
		});

		Then("the response status is {int}", (_ctx, status: number) => {
			expect(watcherOf(world).status).toBe(status);
		});

		And("the error is {string}", (_ctx, error: string) => {
			expect(watcherOf(world).body.errorCode).toBe(error);
		});
	};
}

// The steps of each scenario in the streaming feature, by the scenario's name in the feature's own words.
export function bindEventsStreaming(layer: ShopLayer) {
	return {
		watchesAtOnce: watchesAtOnce(layer),
		pushesChange: pushesChange(layer),
		refusesUnknownSale: refusesUnknownSale(layer),
		hearsAdmitted: hearsAdmitted(layer),
		watchesPlaceFirst: watchesPlaceFirst(layer),
		refusesWrongPlaceTicket: refusesWrongPlaceTicket(layer),
	};
}
