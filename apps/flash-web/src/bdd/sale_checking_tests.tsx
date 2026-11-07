import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { openSale } from "./support/open-sale";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();

const SALE_10 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/sale/checking.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		ScenarioOutline(
			"A shopper checks the outcome",
			({ Given, And, When, Then }, examples) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And('"ana" <history>', () => {
					if (examples.history === "has bought an item") world.hasBought("ana");
					if (examples.history === "holds an item") world.holds("ana");
				});

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				When("she presses Check my status", async () => world.pressCheck());

				Then('the page says "<message>"', async () =>
					world.expectPageSays(String(examples.message)),
				);
			},
		);

		Scenario(
			"A shopper who holds an item can confirm after checking",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And('"ana" holds an item', () => world.holds("ana"));

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("she presses Check my status", async () => world.pressCheck());

				When("she confirms the purchase", async () => world.pressConfirm());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);
			},
		);
	},
);
