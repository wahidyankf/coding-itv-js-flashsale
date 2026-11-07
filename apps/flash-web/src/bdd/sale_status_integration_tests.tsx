// @vitest-environment jsdom
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { afterAll } from "vitest";
import { integrationWorld } from "./support/integration-world";
import { openSale } from "./support/open-sale";
import { specFile } from "./support/paths";

const world = await integrationWorld();
afterAll(() => world.close());

const SALE_WITH_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";

// The sentence the page shows while it waits in line and its live updates still run.
const WAITING_HINT = "You can keep this page open. It updates by itself.";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		ScenarioOutline(
			"The page shows the sale and its status",
			({ Given, When, Then, And }, examples) => {
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

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				When("a visitor opens the page", async () => world.openPage());

				Then('the page shows the status "<label>"', async () => {
					await world.expectPageSays(`Status: ${examples.label}`);
				});

				And("the page shows <left> items left", async () => {
					await world.expectPageSays(`Items left: ${examples.left}`);
				});

				And('the "Buy Now" button is <button>', async () => {
					await world.expectButton("Buy Now", examples.button as "enabled");
				});
			},
		);

		Scenario(
			"The page says so when the last sale is over",
			({ Given, When, Then }) => {
				Given(
					"a sale with stock 10 and 3 sold that opens 2 hours ago and closes 1 hour ago",
					async () => openSale(world, 10, 3, "2 hours ago", "1 hour ago"),
				);

				When("a visitor opens the page", async () => world.openPage());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"The page follows the sale to its end",
			({ Given, And, When, Then }) => {
				Given(SALE_WITH_3, async () =>
					openSale(world, 10, 3, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("the sale ends", async () => world.endSale());

				Then(
					"the page shows the status {string}",
					async (_ctx, label: string) =>
						world.expectPageSays(`Status: ${label}`),
				);

				And('the "Buy Now" button is disabled', async () =>
					world.expectButton("Buy Now", "disabled"),
				);
			},
		);

		Scenario(
			"The page says so when no sale exists",
			({ Given, When, Then }) => {
				Given("no sale exists", () => {});

				When("a visitor opens the page", async () => world.openPage());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"The page follows the sale as it changes",
			({ Given, And, When, Then }) => {
				Given(SALE_WITH_3, async () =>
					openSale(world, 10, 3, "1 hour ago", "in 1 hour"),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("the sold count changes to {int}", async (_ctx, sold: number) =>
					world.setSold(sold),
				);

				Then(
					"the page shows the status {string}",
					async (_ctx, label: string) =>
						world.expectPageSays(`Status: ${label}`),
				);

				And("the page shows {int} items left", async (_ctx, left: number) =>
					world.expectPageSays(`Items left: ${left}`),
				);
			},
		);

		Scenario(
			"The page says so when the sale cannot be reached",
			({ Given, When, Then }) => {
				Given("the sale cannot be reached", () => world.cutOff());

				When("a visitor opens the page", async () => world.openPage());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);

		Scenario(
			"The page says so when live updates stop",
			({ Given, And, When, Then }) => {
				Given(SALE_WITH_3, async () =>
					openSale(world, 10, 3, "1 hour ago", "in 1 hour"),
				);

				And("the queue admits shoppers slowly", () => world.slowAdmission());

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Buy Now", async () => world.pressBuyNow());

				And("the page says it updates by itself", async () =>
					world.expectPageSays(WAITING_HINT),
				);

				When("the live updates keep failing", async () =>
					world.liveUpdatesFail(),
				);

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the page does not say it updates by itself", async () =>
					world.expectPageNotSays(WAITING_HINT),
				);
			},
		);
	},
);
