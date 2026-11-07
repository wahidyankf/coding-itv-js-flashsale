// The steps of specs/apps/flash/be/behaviours/purchase/outcome.feature, as both layers bind them. Each scenario gets the
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

function buyerSeesPurchase(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		When(
			"a client asks for the outcome of {string}",
			async (_ctx, user: string) => {
				await world.outcome(user);
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the outcome state is {string}", (_ctx, state: string) => {
			expect(responseOf(world).json().state).toBe(state);
		});

		And("the purchase is the one {string} had before", (_ctx, user: string) => {
			expect(responseOf(world).json().purchaseId).toBe(
				world.purchases.get(user)?.purchaseId,
			);
		});
	};
}

function holdIsSeen(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When(
			"a client asks for the outcome of {string}",
			async (_ctx, user: string) => {
				await world.outcome(user);
			},
		);

		Then("the outcome state is {string}", (_ctx, state: string) => {
			expect(responseOf(world).json().state).toBe(state);
		});

		And(
			"the reservation is the one {string} had before",
			(_ctx, user: string) => {
				expect(responseOf(world).json().reservationId).toBe(
					world.holds.get(user)?.reservationId,
				);
			},
		);
	};
}

function nothingIsSeen(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		When(
			"a client asks for the outcome of {string}",
			async (_ctx, user: string) => {
				await world.outcome(user);
			},
		);

		Then("the outcome state is {string}", (_ctx, state: string) => {
			expect(responseOf(world).json().state).toBe(state);
		});
	};
}

function expiredHoldIsHidden(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("the hold time of the sale is {int} second", holdSecondsIs(world));

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When("{int} seconds pass", secondsPass(world));

		And(
			"a client asks for the outcome of {string}",
			async (_ctx, user: string) => {
				await world.outcome(user);
			},
		);

		Then("the outcome state is {string}", (_ctx, state: string) => {
			expect(responseOf(world).json().state).toBe(state);
		});
	};
}

function unknownSaleRefused(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given("no sale exists", () => {});

		When(
			"a client asks for the outcome of {string} in the sale with id {string}",
			async (_ctx, user: string, saleId: string) => {
				await world.outcome(user, saleId);
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the outcome feature, by the scenario's name in the feature's own words.
export function bindPurchaseOutcome(layer: ShopLayer) {
	return {
		buyerSeesPurchase: buyerSeesPurchase(layer),
		holdIsSeen: holdIsSeen(layer),
		nothingIsSeen: nothingIsSeen(layer),
		expiredHoldIsHidden: expiredHoldIsHidden(layer),
		unknownSaleRefused: unknownSaleRefused(layer),
	};
}
