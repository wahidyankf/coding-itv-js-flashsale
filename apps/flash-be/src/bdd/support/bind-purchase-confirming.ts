// The steps of specs/apps/flash/be/behaviours/purchase/confirming.feature, as both layers bind them. Each scenario gets the
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import type { Response } from "./response.js";
import { responseOf } from "./response.js";
import {
	admitUser,
	confirmUser,
	holdSecondsIs,
	itemsRemain,
	OPEN_SALE,
	openSale,
	reserveUser,
	type ShopLayer,
	secondsPass,
} from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";

// The sale of the given stock, open from an hour ago until an hour from now, with nothing sold yet.
const saleWithStock = (stock: number) =>
	`a sale with stock ${stock} and 0 sold that opens 1 hour ago and closes in 1 hour`;

function paysForHeld(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the user is {string}", (_ctx, user: string) => {
			expect(responseOf(world).json().userId).toBe(user);
		});

		And("a purchase id is issued", () => {
			expect(responseOf(world).json().purchaseId).toMatch(/^[0-9a-f-]{36}$/);
		});

		And("{int} items remain", itemsRemain(world));
	};
}

function confirmsAgain(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the purchase is the one {string} had before", (_ctx, user: string) => {
			expect(responseOf(world).json().purchaseId).toBe(
				world.purchases.get(user)?.purchaseId,
			);
		});

		And("{int} items remain", itemsRemain(world));
	};
}

function noSecondItem(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		When("{string} reserves an item", reserveUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

// Used for both a reservation id that does not exist and one that is not an id: the same request, the same refusal.
function refusesReservationId(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		When(
			"{string} confirms the purchase with the reservation id {string}",
			async (_ctx, user: string, reservationId: string) => {
				await world.confirm(user, { reservationId });
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function refusesOthersHold(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When(
			"{string} confirms the purchase with the reservation of {string}",
			async (_ctx, user: string, owner: string) => {
				await world.confirm(user, { owner });
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function refusesExpiredHold(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(saleWithStock(1), async () =>
			openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And("the hold time of the sale is {int} second", holdSecondsIs(world));

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When("{int} seconds pass", secondsPass(world));

		And("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function keepsHoldOnDecline(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("the payment provider declines every payment", async () => {
			await world.setPaymentDeclines();
		});

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		And("{string} still holds the item", async (_ctx, user: string) => {
			expect((await world.outcome(user)).json().state).toBe("holding");
		});

		And("{int} items remain", itemsRemain(world));
	};
}

function refundsLatePayment(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(saleWithStock(1), async () =>
			openSale(world, layer.now, { stock: 1, sold: 0 }),
		);

		And("the hold time of the sale is {int} second", holdSecondsIs(world));

		And(
			"the payment provider takes {int} seconds",
			async (_ctx, seconds: number) => {
				await world.setPaymentDuration(seconds);
			},
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When(
			"{string} starts to confirm the purchase",
			async (_ctx, user: string) => {
				await world.startConfirm(user);
			},
		);

		And("{int} seconds pass", secondsPass(world));

		And("{string} buys the last item", async (_ctx, user: string) => {
			await world.sellLastItemTo(user);
		});

		And("the confirmation finishes", async () => {
			await world.finishConfirm();
		});

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		And("the payment of {string} is refunded", async (_ctx, user: string) => {
			expect(await world.wasRefunded(user)).toBe(true);
		});

		And("{string} has no purchase", async (_ctx, user: string) => {
			expect((await world.outcome(user)).json().state).toBe("none");
		});
	};
}

function sellsExactlyStock(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();
		const users = Array.from({ length: 30 }, (_, i) => `shopper${i}`);
		let replies: Response[] = [];

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{int} shoppers have been admitted", async (_ctx, count: number) => {
			await world.admitMany(users.slice(0, count));
		});

		And("all {int} shoppers have tried to reserve an item", async () => {
			await world.reserveAll(users);
		});

		When(
			"every shopper who holds an item confirms the purchase at the same time",
			async () => {
				replies = await world.confirmAllHolders(users);
			},
		);

		Then("{int} purchases are made", (_ctx, count: number) => {
			expect(replies.filter((r) => r.statusCode === 201)).toHaveLength(count);
		});

		And("{int} items remain", itemsRemain(world));

		And("the sale status is {string}", async (_ctx, status: string) => {
			expect((await world.saleView()).status).toBe(status);
		});
	};
}

// The steps of each scenario in the confirming feature, by the scenario's name in the feature's own words.
export function bindPurchaseConfirming(layer: ShopLayer) {
	return {
		paysForHeld: paysForHeld(layer),
		confirmsAgain: confirmsAgain(layer),
		noSecondItem: noSecondItem(layer),
		refusesUnknownId: refusesReservationId(layer),
		refusesNonId: refusesReservationId(layer),
		refusesOthersHold: refusesOthersHold(layer),
		refusesExpiredHold: refusesExpiredHold(layer),
		keepsHoldOnDecline: keepsHoldOnDecline(layer),
		refundsLatePayment: refundsLatePayment(layer),
		sellsExactlyStock: sellsExactlyStock(layer),
	};
}
