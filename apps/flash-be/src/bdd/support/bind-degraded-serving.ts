// The steps of specs/apps/flash/be/behaviours/degraded/serving.feature, as both layers bind them. Redis is switched off and on
// by the layer. Each scenario gets the world its layer makes; the titles stay in the layer's test file, where the
// behaviour checker reads them.
import { expect } from "vitest";
import { type Response, responseOf } from "./response.js";
import {
	holdEndsIn,
	itemsRemain,
	OPEN_SALE,
	openSale,
	type ShopLayer,
	secondsPass,
	userLimitIs,
} from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";
import { shopperNames } from "./users.js";

const SALE_OF_2 =
	"a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour";

function joinsWithoutRedis(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		When('"ana" joins the queue', async () => {
			await world.join("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And("a ticket is issued", () => {
			expect(responseOf(world).json().ticket).toBeTruthy();
		});

		And('"ana" is admitted', async () => {
			const reply = await world.check("ana", world.tickets.get("ana"));
			expect(reply.json().state).toBe("admitted");
		});
	};
}

function reservesWithoutRedis(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		And('"ana" has joined the queue', async () => {
			await world.join("ana");
		});

		When('"ana" reserves an item', async () => {
			await world.reserve("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And("a reservation id is issued", () => {
			expect(responseOf(world).json().reservationId).toMatch(/^[0-9a-f-]{36}$/);
		});

		And("the hold ends in {int} seconds", holdEndsIn(world, layer));
	};
}

function reservesAgainWithoutRedis(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		And('"ana" has joined the queue', async () => {
			await world.join("ana");
		});

		And('"ana" has reserved an item', async () => {
			await world.reserve("ana");
		});

		When('"ana" reserves an item', async () => {
			await world.reserve("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And(
			"the reservation is the one {string} had before",
			(_ctx, user: string) => {
				expect(responseOf(world).json()).toEqual(world.holds.get(user));
			},
		);
	};
}

function manyReserveWithoutRedis(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();
		const users = shopperNames(30);
		let replies: Response[] = [];

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("Redis is down", async () => {
			await world.breakRedis();
		});

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

function paysForHoldBeforeOutage(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ana" has reserved an item', async () => {
			await world.reserve("ana");
		});

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		When('"ana" confirms the purchase', async () => {
			await world.confirm("ana");
		});

		Then("the response status is {int}", statusIs(world));

		And("a purchase id is issued", () => {
			expect(responseOf(world).json().purchaseId).toMatch(/^[0-9a-f-]{36}$/);
		});

		And("{int} items remain", itemsRemain(world));
	};
}

function paysWithoutSlowdown(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();
		const times: number[] = [];

		// Each confirmation is timed, because a dependency that is down must not make a shopper wait.
		const timed = async (user: string) => {
			const started = performance.now();
			await world.confirm(user);
			times.push(performance.now() - started);
		};

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
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

		And('"cai" has reserved an item', async () => {
			await world.reserve("cai");
		});

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		And("{int} seconds pass", secondsPass(world));

		When('"ana" confirms the purchase', async () => timed("ana"));

		And('"ben" confirms the purchase', async () => timed("ben"));

		And('"cai" confirms the purchase', async () => timed("cai"));

		Then(
			"every confirmation answered in less than {int} milliseconds",
			(_ctx, limit: number) => {
				expect(times).toHaveLength(3);
				expect(Math.max(...times)).toBeLessThan(limit);
			},
		);
	};
}

function stillLimited(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"the limit is {int} requests per user in each {int} seconds",
			userLimitIs(world),
		);

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		When('"ana" tries to join the queue 4 times', async () => {
			await world.repeat("join the queue", "ana", 4);
		});

		Then("the first {int} requests are not limited", (_ctx, count: number) => {
			const first = world.replies.slice(0, count);
			expect(first.map((reply) => reply.statusCode)).not.toContain(429);
		});

		And("the response status is {int}", statusIs(world));
	};
}

function countedWithOldData(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_OF_2, async () =>
			openSale(world, layer.now, { stock: 2, sold: 0 }),
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

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		And('"ben" has reserved an item', async () => {
			await world.reserve("ben");
		});

		And("Redis is back with the data it had", async () => {
			await world.fixRedis();
		});

		When('"cai" reserves an item', async () => {
			await world.reserve("cai");
		});

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function survivesNoData(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_OF_2, async () =>
			openSale(world, layer.now, { stock: 2, sold: 0 }),
		);

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ana" has reserved an item', async () => {
			await world.reserve("ana");
		});

		And("Redis is down", async () => {
			await world.breakRedis();
		});

		And('"ben" has joined the queue', async () => {
			await world.join("ben");
		});

		And('"ben" has reserved an item', async () => {
			await world.reserve("ben");
		});

		And("Redis is back with no data", async () => {
			await world.fixRedis();
			await world.loseQueue();
			await world.loseReservationState();
		});

		And('"cai" has been admitted', async () => {
			await world.admitted("cai");
		});

		When('"cai" reserves an item', async () => {
			await world.reserve("cai");
		});

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the degraded serving feature, by the scenario's name in the feature's own words.
export function bindDegradedServing(layer: ShopLayer) {
	return {
		joinsWithoutRedis: joinsWithoutRedis(layer),
		reservesWithoutRedis: reservesWithoutRedis(layer),
		reservesAgainWithoutRedis: reservesAgainWithoutRedis(layer),
		manyReserveWithoutRedis: manyReserveWithoutRedis(layer),
		paysForHoldBeforeOutage: paysForHoldBeforeOutage(layer),
		paysWithoutSlowdown: paysWithoutSlowdown(layer),
		stillLimited: stillLimited(layer),
		countedWithOldData: countedWithOldData(layer),
		survivesNoData: survivesNoData(layer),
	};
}
