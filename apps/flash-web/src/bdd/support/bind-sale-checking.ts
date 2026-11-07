// Binds specs/apps/flash/web/behaviours/sale/checking.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. The layer names the scenarios in its own test file, where the behaviour checker reads
// the titles. The shared bodies are in support/web-steps.ts.
import {
	confirmsPurchase,
	isLoggedIn,
	type OutlineBinder,
	openTenSale,
	pageSays,
	SALE_10,
	type ScenarioBinder,
	visitorOpensPage,
} from "./web-steps";
import type { WebWorld } from "./web-world";

// A shopper checks the outcome, with the history the row names: a bought item, a held item, or neither.
function checksOutcome(world: WebWorld): OutlineBinder {
	return ({ Given, And, When, Then }, examples) => {
		Given(SALE_10, openTenSale(world));
		And('"ana" <history>', () => {
			if (examples.history === "has bought an item") world.hasBought("ana");
			if (examples.history === "holds an item") world.holds("ana");
		});
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Check my status", async () => world.pressCheck());
		Then('the page says "<message>"', async () =>
			world.expectPageSays(String(examples.message)),
		);
	};
}

// A shopper who holds an item can confirm the purchase after checking the status.
function confirmsAfterChecking(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And('"ana" holds an item', () => world.holds("ana"));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("she presses Check my status", async () => world.pressCheck());
		When("she confirms the purchase", confirmsPurchase(world));
		Then("the page says {string}", pageSays(world));
	};
}

// The steps of each scenario in the checking feature, by the scenario's name in the layer's test file.
export function bindSaleChecking(world: WebWorld) {
	return {
		checksOutcome: checksOutcome(world),
		confirmsAfterChecking: confirmsAfterChecking(world),
	};
}
