// The steps of specs/apps/flash/be/behaviours/recovery/rebuild.feature, as both layers bind them. Each scenario gets the
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { responseOf } from "./response.js";
import {
	admitUser,
	confirmUser,
	holdSecondsIs,
	OPEN_SALE,
	openSale,
	reserveUser,
	type ShopLayer,
	secondsPass,
} from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";

const SALE_OF_1 =
	"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour";

function survivesLoss(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_OF_1, async () =>
			openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ben" has been admitted', async () => {
			await world.admitted("ben");
		});

		And('"ana" has reserved an item', async () => {
			await world.reserve("ana");
		});

		And("the reservation state of the sale is lost from Redis", async () => {
			await world.loseReservationState();
		});

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function sameHoldAfterLoss(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_OF_1, async () =>
			openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("the reservation state of the sale is lost from Redis", async () => {
			await world.loseReservationState();
		});

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

function expiredNotRebuilt(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(SALE_OF_1, async () =>
			openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And("the hold time of the sale is {int} second", holdSecondsIs(world));

		And('"ana" has been admitted', async () => {
			await world.admitted("ana");
		});

		And('"ben" has been admitted', async () => {
			await world.admitted("ben");
		});

		And("{string} has reserved an item", reserveUser(world));

		And("the reservation state of the sale is lost from Redis", async () => {
			await world.loseReservationState();
		});

		When("{int} seconds pass", secondsPass(world));

		And("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));
	};
}

function buyerRefusedAfterLoss(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		And("the reservation state of the sale is lost from Redis", async () => {
			await world.loseReservationState();
		});

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the rebuild feature, by the scenario's name in the feature's own words.
export function bindRecoveryRebuild(layer: ShopLayer) {
	return {
		survivesLoss: survivesLoss(layer),
		sameHoldAfterLoss: sameHoldAfterLoss(layer),
		expiredNotRebuilt: expiredNotRebuilt(layer),
		buyerRefusedAfterLoss: buyerRefusedAfterLoss(layer),
	};
}
