// @vitest-environment jsdom
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { integrationWorld } from "./support/integration-world";
import { openSale } from "./support/open-sale";
import { specFile } from "./support/paths";

const world = await integrationWorld();
afterAll(() => world.close());

const SALE_10 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";
const SALE_1 =
	"a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/buying.feature")),
	({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		Scenario("A shopper buys the item", ({ Given, And, When, Then }) => {
			Given(SALE_10, async () =>
				openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
			);

			And("{string} is logged in", async (_ctx, name: string) =>
				world.loggedIn(name),
			);

			And("a visitor has the page open", async () => world.openPage());

			When("she presses Buy Now", async () => world.pressBuyNow());

			Then("the page says {string}", async (_ctx, text: string) =>
				world.expectPageSays(text),
			);

			And("the {string} button is enabled", async (_ctx, name: string) =>
				world.expectButton(name, "enabled"),
			);

			When("she confirms the purchase", async () => world.pressConfirm());

			Then(
				'the page says "You got it! Your purchase is confirmed."',
				async () =>
					world.expectPageSays("You got it! Your purchase is confirmed."),
			);

			And("the page shows {int} items left", async (_ctx, left: number) =>
				world.expectPageSays(`Items left: ${left}`),
			);
		});

		Scenario(
			"A waiting shopper sees their place",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("the queue admits shoppers slowly", () => world.slowAdmission());

				And("{int} shoppers are ahead in the queue", (_ctx, count: number) =>
					world.queueAhead(count),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A shopper who is told the item is gone",
			({ Given, And, When, Then }) => {
				Given(SALE_1, async () =>
					openSale(world, 1, 0, "1 hour ago", "in 1 hour"),
				);

				And('"ben" holds the last item', () => world.holdsLastItem("ben"));

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A shopper who already bought is told so",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And('"ana" has bought an item', () => world.hasBought("ana"));

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A shopper who waits while the sale ends is told so",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("the queue admits shoppers slowly", () => world.slowAdmission());

				And("{int} shoppers are ahead in the queue", (_ctx, count: number) =>
					world.queueAhead(count),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("she presses Buy Now", async () => world.pressBuyNow());

				When("the sale ends", async () => world.endSale());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A shopper who waits while the last items are sold is told so",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("the queue admits shoppers slowly", () => world.slowAdmission());

				And("{int} shoppers are ahead in the queue", (_ctx, count: number) =>
					world.queueAhead(count),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("she presses Buy Now", async () => world.pressBuyNow());

				When("the sold count changes to {int}", async (_ctx, sold: number) =>
					world.setSold(sold),
				);

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A shopper who sends too many requests is told to wait",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And(
					"each user may send {int} write request in each {int} seconds",
					(_ctx, count: number) => world.writeLimit(count),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"A declined payment keeps the hold",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("the payment provider declines every charge", () =>
					world.paymentDeclines(),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("she presses Buy Now", async () => world.pressBuyNow());

				When("she confirms the purchase", async () => world.pressConfirm());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the {string} button is enabled", async (_ctx, name: string) =>
					world.expectButton(name, "enabled"),
				);
			},
		);

		Scenario(
			"A hold that runs out is shown as ended",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("a hold lasts {int} seconds", (_ctx, seconds: number) =>
					world.holdSeconds(seconds),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				And("{int} seconds pass", async (_ctx, seconds: number) =>
					world.advance(seconds),
				);

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the {string} button is disabled", async (_ctx, name: string) =>
					world.expectButton(name, "disabled"),
				);
			},
		);
	},
);
