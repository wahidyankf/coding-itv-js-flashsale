// Binds specs/apps/flash/web/behaviours/account/login.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. The layer names the scenarios in its own test file, where the behaviour checker reads
// the titles. The shared bodies are in support/web-steps.ts.
import {
	buttonIs,
	isLoggedIn,
	noButton,
	type OutlineBinder,
	openTenSale,
	pageSays,
	pressBuyNow,
	SALE_10,
	type ScenarioBinder,
	visitorOpensPage,
} from "./web-steps";
import type { WebWorld } from "./web-world";

// A visitor who is not logged in sees the form, and none of the buying buttons.
function formForVisitor(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		Given(SALE_10, openTenSale(world));
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page says {string}", pageSays(world));
		And("the page has no {string} button", noButton(world));
		And('the page has no "Log out" button', async () =>
			world.expectNoButton("Log out"),
		);
	};
}

// A new shopper signs up, and the page shows the shopper as logged in.
function signUpLogsIn(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When(
			"the visitor signs up as {string} with the password {string}",
			async (_ctx, name: string, password: string) =>
				world.signUp(name, password),
		);
		Then("the page says {string}", pageSays(world));
		And("the {string} button is enabled", buttonIs(world, "enabled"));
	};
}

// A shopper with an account logs in, and the page shows the shopper as logged in.
function logsIn(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And(
			"{string} has an account with the password {string}",
			async (_ctx, name: string, password: string) =>
				world.hasAccount(name, password),
		);
		And("a visitor has the page open", visitorOpensPage(world));
		When(
			"the visitor logs in as {string} with the password {string}",
			async (_ctx, name: string, password: string) =>
				world.logIn(name, password),
		);
		Then("the page says {string}", pageSays(world));
		And("the {string} button is enabled", buttonIs(world, "enabled"));
	};
}

// A login or a sign up that the server refuses is explained on the page, and the buying buttons stay hidden.
function refusedLogin(world: WebWorld): OutlineBinder {
	return ({ Given, And, When, Then }, examples) => {
		Given(SALE_10, openTenSale(world));
		And(
			"{string} has an account with the password {string}",
			async (_ctx, name: string, password: string) =>
				world.hasAccount(name, password),
		);
		And("a visitor has the page open", visitorOpensPage(world));
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
		And("the page has no {string} button", noButton(world));
	};
}

// A name or a password that cannot be used is refused on the sign-up form.
function invalidSignUp(world: WebWorld): OutlineBinder {
	return ({ Given, And, When, Then }, examples) => {
		Given(SALE_10, openTenSale(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When(
			'the visitor signs up as "<name>" with the password "<password>"',
			async () =>
				world.signUp(String(examples.name), String(examples.password)),
		);
		Then('the page says "<message>"', async () =>
			world.expectPageSays(String(examples.message)),
		);
		And("the page has no {string} button", noButton(world));
	};
}

// A shopper who is logged in is still known when the page opens again.
function knownWhenOpenedAgain(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page says {string}", pageSays(world));
		And("the page has no {string} button", noButton(world));
	};
}

// A shopper logs out, and the browser keeps no login.
function logsOut(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		When("the visitor logs out", async () => world.logOut());
		Then("the page says {string}", pageSays(world));
		And("the page has no {string} button", noButton(world));
		And("the browser holds no login", async () => world.expectNoLogin());
	};
}

// A shopper whose short token has ended still buys, without being asked to log in again.
function shortTokenEnds(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("the short token of every login has ended", () =>
			world.accessTokenEnds(),
		);
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
		And('the page says "Signed in as ana"', async () =>
			world.expectPageSays("Signed in as ana"),
		);
	};
}

// A login that ended is replaced by the form, and the page gives the reason.
function loginEnded(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		And("a visitor has the page open", visitorOpensPage(world));
		And("every login has ended", () => world.loginEnds());
		When("she presses Buy Now", pressBuyNow(world));
		Then("the page says {string}", pageSays(world));
		And('the page says "Log in to buy"', async () =>
			world.expectPageSays("Log in to buy"),
		);
		And("the page has no {string} button", noButton(world));
	};
}

// The steps of each scenario in the account login feature, by the scenario's name in the layer's test file.
export function bindAccountLogin(world: WebWorld) {
	return {
		formForVisitor: formForVisitor(world),
		signUpLogsIn: signUpLogsIn(world),
		logsIn: logsIn(world),
		refusedLogin: refusedLogin(world),
		invalidSignUp: invalidSignUp(world),
		knownWhenOpenedAgain: knownWhenOpenedAgain(world),
		logsOut: logsOut(world),
		shortTokenEnds: shortTokenEnds(world),
		loginEnded: loginEnded(world),
	};
}
