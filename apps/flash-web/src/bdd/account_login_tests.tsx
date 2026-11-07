import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { openSale } from "./support/open-sale";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";

const world = unitWorld();

const SALE_10 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/account/login.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => world.reset());
		AfterEachScenario(() => world.clear());

		Scenario(
			"A visitor who is not logged in sees the form instead of the buying buttons",
			({ Given, When, Then, And }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				When("a visitor opens the page", async () => world.openPage());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the page has no {string} button", async (_ctx, name: string) =>
					world.expectNoButton(name),
				);

				And('the page has no "Log out" button', async () =>
					world.expectNoButton("Log out"),
				);
			},
		);

		Scenario(
			"A new shopper signs up and is logged in",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("a visitor has the page open", async () => world.openPage());

				When(
					"the visitor signs up as {string} with the password {string}",
					async (_ctx, name: string, password: string) =>
						world.signUp(name, password),
				);

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the {string} button is enabled", async (_ctx, name: string) =>
					world.expectButton(name, "enabled"),
				);
			},
		);

		Scenario(
			"A shopper with an account logs in",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And(
					"{string} has an account with the password {string}",
					async (_ctx, name: string, password: string) =>
						world.hasAccount(name, password),
				);

				And("a visitor has the page open", async () => world.openPage());

				When(
					"the visitor logs in as {string} with the password {string}",
					async (_ctx, name: string, password: string) =>
						world.logIn(name, password),
				);

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the {string} button is enabled", async (_ctx, name: string) =>
					world.expectButton(name, "enabled"),
				);
			},
		);

		ScenarioOutline(
			"A login or a sign up that the server refuses is explained in words",
			({ Given, And, When, Then }, examples) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And(
					"{string} has an account with the password {string}",
					async (_ctx, name: string, password: string) =>
						world.hasAccount(name, password),
				);

				And("a visitor has the page open", async () => world.openPage());

				When(
					'the visitor <action> as "<name>" with the password "<password>"',
					async () => {
						const attempt =
							examples.action === "logs in" ? world.logIn : world.signUp;
						await attempt(String(examples.name), String(examples.password));
					},
				);

				Then('the page says "<message>"', async () =>
					world.expectPageSays(String(examples.message)),
				);

				And("the page has no {string} button", async (_ctx, name: string) =>
					world.expectNoButton(name),
				);
			},
		);

		ScenarioOutline(
			"A name or a password that cannot be used is refused on the form",
			({ Given, And, When, Then }, examples) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("a visitor has the page open", async () => world.openPage());

				When(
					'the visitor signs up as "<name>" with the password "<password>"',
					async () =>
						world.signUp(String(examples.name), String(examples.password)),
				);

				Then('the page says "<message>"', async () =>
					world.expectPageSays(String(examples.message)),
				);

				And("the page has no {string} button", async (_ctx, name: string) =>
					world.expectNoButton(name),
				);
			},
		);

		Scenario(
			"A shopper who is logged in is known when the page opens again",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				When("a visitor opens the page", async () => world.openPage());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And("the page has no {string} button", async (_ctx, name: string) =>
					world.expectNoButton(name),
				);
			},
		);

		Scenario("A shopper logs out", ({ Given, And, When, Then }) => {
			Given(SALE_10, async () =>
				openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
			);

			And("{string} is logged in", async (_ctx, name: string) =>
				world.loggedIn(name),
			);

			And("a visitor has the page open", async () => world.openPage());

			When("the visitor logs out", async () => world.logOut());

			Then("the page says {string}", async (_ctx, text: string) =>
				world.expectPageSays(text),
			);

			And("the page has no {string} button", async (_ctx, name: string) =>
				world.expectNoButton(name),
			);

			And("the browser holds no login", async () => world.expectNoLogin());
		});

		Scenario(
			"A login that lost only its short token carries on without asking again",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("the short token of every login has ended", () =>
					world.accessTokenEnds(),
				);

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And('the page says "Signed in as ana"', async () =>
					world.expectPageSays("Signed in as ana"),
				);
			},
		);

		Scenario(
			"A login that ended is replaced by the form, with the reason",
			({ Given, And, When, Then }) => {
				Given(SALE_10, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				And("a visitor has the page open", async () => world.openPage());

				And("every login has ended", () => world.loginEnds());

				When("she presses Buy Now", async () => world.pressBuyNow());

				Then("the page says {string}", async (_ctx, text: string) =>
					world.expectPageSays(text),
				);

				And('the page says "Log in to buy"', async () =>
					world.expectPageSays("Log in to buy"),
				);

				And("the page has no {string} button", async (_ctx, name: string) =>
					world.expectNoButton(name),
				);
			},
		);
	},
);
