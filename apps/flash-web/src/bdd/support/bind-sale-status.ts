// Binds specs/apps/flash/web/behaviours/sale/status.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. The layer names the scenarios in its own test file, where the behaviour checker reads
// the titles. The shared bodies are in support/web-steps.ts.
import { openSale } from "./open-sale";
import {
	admitsSlowly,
	isLoggedIn,
	type OutlineBinder,
	openSaleWithThree,
	pageSays,
	pressBuyNow,
	SALE_WITH_3,
	type ScenarioBinder,
	visitorOpensPage,
} from "./web-steps";
import type { WebWorld } from "./web-world";

// The sentence the page shows while it waits in line and its live updates still run.
const WAITING_HINT = "You can keep this page open. It updates by itself.";

// The page shows the sale's status, the items left and the buying button, as the row of the outline says.
function showsSaleStatus(world: WebWorld): OutlineBinder {
	return ({ Given, And, When, Then }, examples) => {
		Given(
			"a sale with stock 10 and <sold> sold that opens <opens> and closes <closes>",
			async () => {
				await openSale(
					world,
					10,
					Number(examples.sold),
					String(examples.opens),
					String(examples.closes),
				);
			},
		);
		And("{string} is logged in", isLoggedIn(world));
		When("a visitor opens the page", visitorOpensPage(world));
		Then('the page shows the status "<label>"', async () => {
			await world.expectPageSays(`Status: ${examples.label}`);
		});
		And("the page shows <left> items left", async () => {
			await world.expectPageSays(`Items left: ${examples.left}`);
		});
		And('the "Buy Now" button is <button>', async () => {
			await world.expectButton("Buy Now", examples.button as "enabled");
		});
	};
}

// The last sale is over, so the page says so.
function lastSaleOver(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		Given(
			"a sale with stock 10 and 3 sold that opens 2 hours ago and closes 1 hour ago",
			async () => openSale(world, 10, 3, "2 hours ago", "1 hour ago"),
		);
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page says {string}", pageSays(world));
	};
}

// The page follows the sale to its end: the status changes and the buying button is disabled.
function followsToEnd(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_WITH_3, openSaleWithThree(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("the sale ends", async () => world.endSale());
		Then("the page shows the status {string}", async (_ctx, label: string) =>
			world.expectPageSays(`Status: ${label}`),
		);
		And('the "Buy Now" button is disabled', async () =>
			world.expectButton("Buy Now", "disabled"),
		);
	};
}

// With no sale in the store, the page says so.
function noSale(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		Given("no sale exists", () => {});
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page says {string}", pageSays(world));
	};
}

// The page follows the sale as the sold count changes, with the status and the items left.
function followsChanges(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_WITH_3, openSaleWithThree(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("the sold count changes to {int}", async (_ctx, sold: number) =>
			world.setSold(sold),
		);
		Then("the page shows the status {string}", async (_ctx, label: string) =>
			world.expectPageSays(`Status: ${label}`),
		);
		And("the page shows {int} items left", async (_ctx, left: number) =>
			world.expectPageSays(`Items left: ${left}`),
		);
	};
}

// When the sale cannot be reached, the page says so.
function cannotBeReached(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		Given("the sale cannot be reached", () => world.cutOff());
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page says {string}", pageSays(world));
	};
}

// When the live updates stop, the page says so, and it no longer says it updates by itself.
function liveUpdatesStop(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_WITH_3, openSaleWithThree(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		And("the page says it updates by itself", async () =>
			world.expectPageSays(WAITING_HINT),
		);
		When("the live updates keep failing", async () => world.liveUpdatesFail());
		Then("the page says {string}", pageSays(world));
		And("the page does not say it updates by itself", async () =>
			world.expectPageNotSays(WAITING_HINT),
		);
	};
}

// The steps of each scenario in the status feature, by the scenario's name in the layer's test file.
export function bindSaleStatus(world: WebWorld) {
	return {
		showsSaleStatus: showsSaleStatus(world),
		lastSaleOver: lastSaleOver(world),
		followsToEnd: followsToEnd(world),
		noSale: noSale(world),
		followsChanges: followsChanges(world),
		cannotBeReached: cannotBeReached(world),
		liveUpdatesStop: liveUpdatesStop(world),
	};
}
