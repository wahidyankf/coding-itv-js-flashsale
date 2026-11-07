// The steps of specs/apps/flash/be/behaviours/queue/joining.feature, as both layers bind them. Each scenario gets the world
// its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { responseOf } from "./response.js";
import { joinUser, OPEN_SALE, openSale, type ShopLayer } from "./shop-steps.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";
import { relativeTime } from "./time.js";

function returnsTicket(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		When("{string} joins the queue", joinUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the user is {string}", (_ctx, user: string) => {
			expect(responseOf(world).json().userId).toBe(user);
		});

		And("a ticket is issued", () => {
			expect(responseOf(world).json().ticket).toMatch(/^[\w-]{20,}$/);
		});

		And("the place in line is {int}", (_ctx, place: number) => {
			expect(responseOf(world).json().place).toBe(place);
		});
	};
}

function placedInOrder(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
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
	};
}

function joinsTwice(layer: ShopLayer): ScenarioBinder {
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

		When('"ana" joins the queue again', async () => {
			await world.join("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And("the place in line is {int}", (_ctx, place: number) => {
			expect(responseOf(world).json().place).toBe(place);
		});

		And("the ticket is the one {string} had before", (_ctx, user: string) => {
			expect(responseOf(world).json().ticket).toBe(world.tickets.get(user));
		});
	};
}

function trimsName(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		When("{string} joins the queue", joinUser(world));

		Then("the user is {string}", (_ctx, user: string) => {
			expect(responseOf(world).json().userId).toBe(user);
		});
	};
}

function refusesFullSale(layer: ShopLayer): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 10 and <sold> sold that opens 2 hours ago and closes <closes>",
			async () => {
				await world.addSale({
					sold: Number(examples.sold),
					startsAt: relativeTime("2 hours ago", layer.now),
					endsAt: relativeTime(String(examples.closes), layer.now),
				});
			},
		);

		When("{string} joins the queue", joinUser(world));

		Then("the response status is {int}", statusIs(world));

		And('the error is "<error>"', () => {
			expect(responseOf(world).json().errorCode).toBe(examples.error);
		});
	};
}

function refusesUnknownSale(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given("no sale exists", () => {});

		When(
			"{string} joins the queue of the sale with id {string}",
			async (_ctx, user: string, saleId: string) => {
				await world.join(user, saleId);
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the joining feature, by the scenario's name in the feature's own words.
export function bindQueueJoining(layer: ShopLayer) {
	return {
		returnsTicket: returnsTicket(layer),
		placedInOrder: placedInOrder(layer),
		joinsTwice: joinsTwice(layer),
		trimsName: trimsName(layer),
		refusesFullSale: refusesFullSale(layer),
		refusesUnknownSale: refusesUnknownSale(layer),
	};
}
