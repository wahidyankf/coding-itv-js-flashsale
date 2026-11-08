// The steps of the confirming scenario where another confirmation of the same hold gives the shared charge back before
// this one commits, as both the unit and the integration layer bind them. The e2e layer is exempt: a running server
// cannot be made to place a refund between a charge and its commit.
import { expect } from "vitest";
import {
	admitUser,
	confirmUser,
	itemsRemain,
	OPEN_SALE,
	openSale,
	reserveUser,
	type ShopLayer,
} from "./shop-steps.js";
import { errorIs, type ScenarioBinder, statusIs } from "./steps.js";

// The commit finds its charge refunded and writes nothing, so the shopper is told the payment failed and keeps the hold;
// paying again is a new charge, and it makes the purchase.
export function bindChargeGivenBack(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And("{string} has been admitted", admitUser(world));

		And("{string} has reserved an item", reserveUser(world));

		And(
			"another confirmation of the hold gives the charge back before the commit of {string}",
			async () => {
				await world.giveBackNextCharge();
			},
		);

		When("{string} confirms the purchase", confirmUser(world));

		Then("the response status is {int}", statusIs(world));

		And("the error is {string}", errorIs(world));

		And("{string} still holds the item", async (_ctx, user: string) => {
			expect((await world.outcome(user)).json().state).toBe("holding");
		});

		And("{int} items remain", itemsRemain(world));

		When("{string} confirms the purchase again", confirmUser(world));

		// A second check of the status, bound by its exact text so it finds its own line.
		Then("the response status is 201", () => {
			expect(world.response?.statusCode).toBe(201);
		});

		// The second count, bound by its exact text for the same reason.
		And("9 items remain", async () => {
			expect((await world.saleView()).remaining).toBe(9);
		});
	};
}
