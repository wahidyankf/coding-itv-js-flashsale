// Binds specs/apps/flash/web/behaviours/sale/buying.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. The layer names the scenarios in its own test file, where the behaviour checker reads
// the titles. The shared bodies are in support/web-steps.ts.
import { openSale } from "./open-sale";
import {
	admitsSlowly,
	buttonIs,
	confirmsPurchase,
	isLoggedIn,
	openTenSale,
	pageSays,
	pressBuyNow,
	SALE_10,
	type ScenarioBinder,
	showsPurchaseId,
	visitorOpensPage,
} from "./web-steps";
import type { WebWorld } from "./web-world";

// A sale with a single item, which the scenario that runs out of items opens.
const SALE_1 =
	"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour";

// "{int} shoppers are ahead in the queue": the fake queue puts that many shoppers in front of the visitor.
function shoppersAhead(world: WebWorld) {
	return (_ctx: unknown, count: number) => world.queueAhead(count);
}

// A shopper buys the item: the hold is confirmed and the page says it is confirmed, with the items left.
function buysItem(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
		And("the {string} button is enabled", buttonIs(world, "enabled"));
		When("she confirms the purchase", confirmsPurchase(world));
		Then('the page says "You got it! Your purchase is confirmed."', async () =>
			world.expectPageSays("You got it! Your purchase is confirmed."),
		);
		And(
			'the page shows the Purchase ID of "ana"\'s purchase',
			showsPurchaseId(world, "ana"),
		);
		And("the page shows {int} items left", async (_ctx, left: number) =>
			world.expectPageSays(`Items left: ${left}`),
		);
	};
}

// A waiting shopper sees their place in the queue.
function waitingSeesPlace(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{int} shoppers are ahead in the queue", shoppersAhead(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
	};
}

// A shopper is told the item is gone when the last item is held by someone else.
function toldGone(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_1, async () => openSale(world, 1, 0, "1 hour ago", "in 1 hour"));
		And('"ben" holds the last item', () => world.holdsLastItem("ben"));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
	};
}

// A shopper who already bought is told so, and is not offered another item.
function alreadyBought(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And('"ana" has bought an item', () => world.hasBought("ana"));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
	};
}

// A shopper who waits in the queue is told so when the sale ends before the shopper's turn.
function waitsSaleEnds(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{int} shoppers are ahead in the queue", shoppersAhead(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("she presses Buy Now", pressBuyNow(world));
		When("the sale ends", async () => world.endSale());
		Then("the page says {string}", pageSays(world));
	};
}

// A shopper who waits in the queue is told so when the last items are sold before the shopper's turn.
function waitsLastItemsSold(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{int} shoppers are ahead in the queue", shoppersAhead(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("she presses Buy Now", pressBuyNow(world));
		When("the sold count changes to {int}", async (_ctx, sold: number) =>
			world.setSold(sold),
		);
		Then("the page says {string}", pageSays(world));
	};
}

// A shopper who sends too many requests in a short time is told to wait.
function tooManyRequests(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And(
			"each user may send {int} write request in each {int} seconds",
			(_ctx, count: number) => world.writeLimit(count),
		);
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
	};
}

// A declined payment keeps the hold, so the shopper can try to pay again.
function declinedKeepsHold(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the payment provider declines every charge", () =>
			world.paymentDeclines(),
		);
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("she presses Buy Now", pressBuyNow(world));
		When("she confirms the purchase", confirmsPurchase(world));
		Then("the page says {string}", pageSays(world));
		And("the {string} button is enabled", buttonIs(world, "enabled"));
	};
}

// A hold that runs out is shown as ended, and the buying button is disabled.
function holdEnds(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("a hold lasts {int} seconds", (_ctx, seconds: number) =>
			world.holdSeconds(seconds),
		);
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		And("{int} seconds pass", async (_ctx, seconds: number) =>
			world.advance(seconds),
		);
		Then("the page says {string}", pageSays(world));
		And("the {string} button is disabled", buttonIs(world, "disabled"));
	};
}

// A waiting shopper whose place is lost is told to join again.
function placeLost(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{int} shoppers are ahead in the queue", shoppersAhead(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
		When("the queue is lost", async () => world.loseQueue());
		Then(
			'the page says "Your place was lost. Press Buy Now to join again."',
			async () =>
				world.expectPageSays(
					"Your place was lost. Press Buy Now to join again.",
				),
		);
	};
}

// A waiting shopper whose access cookie runs out keeps seeing their place: the page renews the login when it opens the
// place stream again, so the loss of the place still reaches the shopper, who stays logged in.
function waitingCookieRunsOut(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("the queue admits shoppers slowly", admitsSlowly(world));
		And("{int} shoppers are ahead in the queue", shoppersAhead(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
		When("the access cookie runs out", () => world.accessTokenEnds());
		And("the live connection drops", async () => world.liveConnectionDrops());
		And("the queue is lost", async () => world.loseQueue());
		Then(
			'the page says "Your place was lost. Press Buy Now to join again."',
			async () =>
				world.expectPageSays(
					"Your place was lost. Press Buy Now to join again.",
				),
		);
		And('the page says "Signed in as ana"', async () =>
			world.expectPageSays("Signed in as ana"),
		);
	};
}

// The steps of each scenario in the buying feature, by the scenario's name in the layer's test file.
export function bindSaleBuying(world: WebWorld) {
	return {
		buysItem: buysItem(world),
		waitingSeesPlace: waitingSeesPlace(world),
		toldGone: toldGone(world),
		alreadyBought: alreadyBought(world),
		waitsSaleEnds: waitsSaleEnds(world),
		waitsLastItemsSold: waitsLastItemsSold(world),
		tooManyRequests: tooManyRequests(world),
		declinedKeepsHold: declinedKeepsHold(world),
		holdEnds: holdEnds(world),
		placeLost: placeLost(world),
		waitingCookieRunsOut: waitingCookieRunsOut(world),
	};
}
