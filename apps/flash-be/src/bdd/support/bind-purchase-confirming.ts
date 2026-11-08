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
import { shopperNames } from "./users.js";

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
			expect((await world.paymentOf(user))?.status).toBe("refunded");
		});

		And(
			"the payment of {string} was charged once and refunded once",
			async (_ctx, user: string) => {
				expect(await world.paymentOf(user)).toEqual({
					status: "refunded",
					ref: expect.stringMatching(/^mock-/),
					attempts: 1,
				});
			},
		);

		And("{string} has no purchase", async (_ctx, user: string) => {
			expect((await world.outcome(user)).json().state).toBe("none");
		});
	};
}

function chargesOnceOnTwoInstances(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		// Both instances find no charge before either one settles, so the ledger alone decides who charges.
		And(
			"the payment provider takes {int} second",
			async (_ctx, seconds: number) => {
				await world.setPaymentDuration(seconds);
			},
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		When(
			"{string} confirms the purchase on two instances at the same time",
			async (_ctx, user: string) => {
				await world.confirmOnTwoInstances(user);
			},
		);

		// One confirmation writes the purchase (201) and the other gets it back as a repeat (200), whichever instance is first.
		Then("both confirmations answer with the same purchase", () => {
			const [first, second] = world.replies;
			expect(world.replies.map((reply) => reply.statusCode).sort()).toEqual([
				200, 201,
			]);
			expect(first?.json().purchaseId).toEqual(expect.any(String));
			expect(second?.json().purchaseId).toBe(first?.json().purchaseId);
		});

		And(
			"the payment of {string} is charged once",
			async (_ctx, user: string) => {
				expect(await world.paymentOf(user)).toEqual({
					status: "charged",
					ref: expect.stringMatching(/^mock-/),
					attempts: 1,
				});
			},
		);

		And("{int} items remain", itemsRemain(world));
	};
}

function chargesOnceAfterDecline(layer: ShopLayer): ScenarioBinder {
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

		And(
			"{string} has tried to confirm the purchase and was declined",
			async (_ctx, user: string) => {
				expect((await world.confirm(user)).statusCode).toBe(402);
			},
		);

		And("the payment provider accepts every payment", async () => {
			await world.setPaymentAccepts();
		});

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And(
			"the payment of {string} is charged on the second attempt",
			async (_ctx, user: string) => {
				expect(await world.paymentOf(user)).toEqual({
					status: "charged",
					ref: expect.stringMatching(/^mock-/),
					attempts: 2,
				});
			},
		);

		And("{int} items remain", itemsRemain(world));
	};
}

function sellsExactlyStock(layer: ShopLayer): ScenarioBinder {
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

function refusesEmptyBody(layer: ShopLayer): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		// The shopper holds nothing, so the request names no reservation: its body is {}.
		When(
			"{string} confirms the purchase with an empty body",
			async (_ctx, user: string) => {
				expect(world.holds.has(user)).toBe(false);
				await world.confirm(user);
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));
	};
}

function refusesEndedSale(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("the sale has ended", async () => {
			await world.endSale();
		});

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		And("{int} items remain", itemsRemain(world));
	};
}

function refusesSecondPurchase(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And("{string} has confirmed the purchase", confirmUser(world));

		When(
			"{string} confirms the purchase with the reservation id {string}",
			async (_ctx, user: string, reservationId: string) => {
				await world.confirm(user, { reservationId });
			},
		);

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		And("{int} items remain", itemsRemain(world));
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
		chargesOnceOnTwoInstances: chargesOnceOnTwoInstances(layer),
		chargesOnceAfterDecline: chargesOnceAfterDecline(layer),
		sellsExactlyStock: sellsExactlyStock(layer),
		refusesEmptyBody: refusesEmptyBody(layer),
		refusesEndedSale: refusesEndedSale(layer),
		refusesSecondPurchase: refusesSecondPurchase(layer),
	};
}
