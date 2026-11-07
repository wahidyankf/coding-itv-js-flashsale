// The steps of specs/apps/flash/be/behaviours/queue/admission.feature, as both layers bind them. Each scenario gets the world
// its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { responseOf } from "./response.js";
import { joinUser, OPEN_SALE, openSale, type ShopLayer } from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";
import { relativeTime } from "./time.js";

function admitsInOrder(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
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
	};
}

function waitsBeforeOpen(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours",
			async () => {
				await world.addSale({
					startsAt: relativeTime("in 1 hour", layer.now),
					endsAt: relativeTime("in 2 hours", layer.now),
				});
			},
		);

		And("{string} has joined the queue", joinUser(world));

		When("admission runs once", async () => {
			await world.admit();
		});

		Then('"ana" is waiting at place 1', async () => {
			const reply = await world.check("ana", world.tickets.get("ana"));
			expect(reply.json()).toMatchObject({ state: "waiting", place: 1 });
		});
	};
}

function admitsRunningSale(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"a later sale that opens in 2 hours and closes in 3 hours",
			async () => {
				// The scenario keeps talking about the running sale; the later one only has to exist.
				const running = world.saleId;
				await world.addSale({
					startsAt: relativeTime("in 2 hours", layer.now),
					endsAt: relativeTime("in 3 hours", layer.now),
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
	};
}

function readsPlace(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
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

		Then("the response status is {int}", statusIs(world));

		And("the place in line is {int}", (_ctx, place: number) => {
			expect(responseOf(world).json().place).toBe(place);
		});
	};
}

function refusesWrongTicket(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has joined the queue", joinUser(world));

		When('"ana" checks the queue with a wrong ticket', async () => {
			await world.check("ana", "not-the-ticket");
		});

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function placeLost(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
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

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the admission feature, by the scenario's name in the feature's own words.
export function bindQueueAdmission(layer: ShopLayer) {
	return {
		admitsInOrder: admitsInOrder(layer),
		waitsBeforeOpen: waitsBeforeOpen(layer),
		admitsRunningSale: admitsRunningSale(layer),
		readsPlace: readsPlace(layer),
		refusesWrongTicket: refusesWrongTicket(layer),
		placeLost: placeLost(layer),
	};
}
