// The steps of specs/apps/flash/be/behaviours/reservation/reserving.feature, as both layers bind them. Each scenario gets the
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { type Response, responseOf } from "./response.js";
import {
	admitUser,
	confirmUser,
	holdEndsIn,
	holdSecondsIs,
	joinUser,
	OPEN_SALE,
	openSale,
	reserveUser,
	type ShopLayer,
	secondsPass,
} from "./shop-steps.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";
import { relativeTime } from "./time.js";
import { shopperNames } from "./users.js";

function reservesItem(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the user is {string}", (_ctx, user: string) => {
			expect(responseOf(world).json().userId).toBe(user);
		});

		And("a reservation id is issued", () => {
			expect(responseOf(world).json().reservationId).toMatch(/^[0-9a-f-]{36}$/);
		});

		And("the hold ends in {int} seconds", holdEndsIn(world, layer));
	};
}

function reservesAgain(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And(
			"the reservation is the one {string} had before",
			(_ctx, user: string) => {
				expect(responseOf(world).json()).toEqual(world.holds.get(user));
			},
		);
	};
}

function waitingCannotReserve(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has joined the queue", joinUser(world));

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function wrongTicketCannotReserve(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		When(
			"{string} reserves an item with a wrong ticket",
			async (_ctx, user: string) => {
				await world.reserve(user, { ticket: "not-the-ticket" });
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function toldQueueLost(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		And("the queue is lost", async () => {
			await world.loseQueue();
		});

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function notSelling(layer: ShopLayer): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 10 and <sold> sold that opens <opens> and closes <closes>",
			async () => {
				await world.addSale({
					stock: 10,
					sold: Number(examples.sold),
					startsAt: relativeTime(String(examples.opens), layer.now),
					endsAt: relativeTime(String(examples.closes), layer.now),
				});
			},
		);

		When("{string} reserves an item", reserveUser(world));

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
			"{string} reserves an item in the sale with id {string}",
			async (_ctx, user: string, saleId: string) => {
				await world.reserve(user, { saleId });
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function holdsCountAgainstStock(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour",
			async () => openSale(world, layer.now, { stock: 2, sold: 0 }),
		);

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ben" has been admitted', async () => {
			await world.admitted("ben");
		});

		And('"cai" has been admitted', async () => {
			await world.admitted("cai");
		});

		And('"ana" has reserved an item', async () => {
			await world.reserve("ana");
		});

		And('"ben" has reserved an item', async () => {
			await world.reserve("ben");
		});

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function expiredHoldGivesBack(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
			async () => openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And("the hold time of the sale is {int} second", holdSecondsIs(world));

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ben" has been admitted', async () => {
			await world.admitted("ben");
		});

		And("{string} has reserved an item", reserveUser(world));

		When("{int} seconds pass", secondsPass(world));

		And("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));
	};
}

function manyReserveAtOnce(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();
		const users = shopperNames(30);
		let replies: Response[] = [];

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{int} shoppers have been admitted", async (_ctx, count: number) => {
			await world.admitMany(users.slice(0, count));
		});

		When("all {int} shoppers reserve an item at the same time", async () => {
			replies = await world.reserveAll(users);
		});

		Then("{int} reservations are granted", (_ctx, count: number) => {
			expect(replies.filter((r) => r.statusCode === 201)).toHaveLength(count);
		});

		And(
			"{int} shoppers are told the item is sold out",
			(_ctx, count: number) => {
				const soldOut = replies.filter(
					(r) => r.statusCode === 409 && r.json().errorCode === "sold_out",
				);
				expect(soldOut).toHaveLength(count);
			},
		);
	};
}

function writeFailureGivesBack(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour",
			async () => openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ben" has been admitted', async () => {
			await world.admitted("ben");
		});

		And("Postgres refuses to save reservations", async () => {
			await world.breakWrites();
		});

		When('"ana" reserves an item and the write fails', async () => {
			expect((await world.reserve("ana")).statusCode).toBe(500);
		});

		And("Postgres saves reservations again", async () => {
			await world.fixWrites();
		});

		And('"ben" reserves an item', async () => {
			await world.reserve("ben");
		});

		Then("the response status is {int}", statusIs(world));
	};
}

// The steps of each scenario in the reserving feature, by the scenario's name in the feature's own words.
export function bindReservationReserving(layer: ShopLayer) {
	return {
		reservesItem: reservesItem(layer),
		reservesAgain: reservesAgain(layer),
		waitingCannotReserve: waitingCannotReserve(layer),
		wrongTicketCannotReserve: wrongTicketCannotReserve(layer),
		toldQueueLost: toldQueueLost(layer),
		notSelling: notSelling(layer),
		refusesUnknownSale: refusesUnknownSale(layer),
		holdsCountAgainstStock: holdsCountAgainstStock(layer),
		expiredHoldGivesBack: expiredHoldGivesBack(layer),
		manyReserveAtOnce: manyReserveAtOnce(layer),
		writeFailureGivesBack: writeFailureGivesBack(layer),
	};
}
