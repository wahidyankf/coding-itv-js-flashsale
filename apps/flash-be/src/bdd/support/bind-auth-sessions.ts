// The steps of specs/apps/flash/be/behaviours/auth/sessions.feature, as both layers bind them. Each scenario gets the auth
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { loggedInAs, signedUp } from "./auth-steps.js";
import type { AuthWorld } from "./auth-world.js";
import { responseOf } from "./response.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

const SIGNED_UP = "{string} has signed up with the password {string}";
const COPY = "the shopper keeps a copy of the tokens";
const COPY_REFUSED = "the copy of the access token is refused";
const LOGGED_IN_AS = "the shopper is logged in as {string}";

// Both session cookies must be HttpOnly, so page scripts cannot read them.
function cookies(world: AuthWorld) {
	return (_ctx: unknown, access: string, refresh: string) => {
		for (const name of [access, refresh]) {
			const cookie = world.setCookies.find((c) => c.startsWith(`${name}=`));
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
		}
	};
}

function account(world: AuthWorld) {
	return (_ctx: unknown, name: string, role: string) => {
		expect(responseOf(world).json()).toEqual({ username: name, role });
	};
}

// The shopper keeps a copy of the tokens they hold now, to send later as a thief would.
function keepsCopy(world: AuthWorld) {
	return () => {
		world.keepCopy();
	};
}

// The copy of the access token is refused: the copy does not log anyone in.
function copyRefused(world: AuthWorld) {
	return async () => {
		const reply = await world.meWithCopy();
		expect(reply.statusCode).toBe(401);
		expect(reply.json().errorCode).toBe("not_authenticated");
	};
}

function asksLoggedIn(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When("the shopper asks who is logged in", async () => {
			await world.me();
		});
		Then("the response status is {int}", statusIs(world));
		And("the account is {string}, a {string}", account(world));
	};
}

function logsOutEnds(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		And(COPY, keepsCopy(world));
		When("the shopper logs out", async () => {
			await world.logOut();
		});
		Then("the response status is {int}", statusIs(world));
		And("the reply clears both cookies", () => {
			expect(world.setCookies).toHaveLength(2);
			for (const cookie of world.setCookies) {
				expect(cookie).toContain("Max-Age=0");
			}
		});
		And(COPY_REFUSED, copyRefused(world));
	};
}

function logsOutTwice(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When("the shopper logs out", async () => {
			await world.logOut();
		});
		And("the shopper logs out", async () => {
			await world.logOut();
		});
		Then("the response status is {int}", statusIs(world));
	};
}

function refusesExpiredAccess(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When("the access token expires", async () => {
			await world.expireAccess();
		});
		And("the shopper asks who is logged in", async () => {
			await world.me();
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
	};
}

function refreshTrades(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		And(COPY, keepsCopy(world));
		When("the shopper refreshes the login", async () => {
			await world.refresh();
		});
		Then("the response status is {int}", statusIs(world));
		And(
			"the reply sets an {string} cookie and a {string} cookie, both HttpOnly",
			cookies(world),
		);
		And(COPY_REFUSED, copyRefused(world));
		And(LOGGED_IN_AS, loggedInAs(world));
	};
}

function refreshTwiceEnds(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		And(COPY, keepsCopy(world));
		And("the shopper refreshes the login", async () => {
			expect((await world.refresh()).statusCode).toBe(200);
		});
		When("the copy of the refresh token is used", async () => {
			await world.refreshWithCopy();
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
		And("the shopper is no longer logged in", async () => {
			const reply = await world.me();
			expect(reply.statusCode).toBe(401);
		});
	};
}

function refreshWithoutToken(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();

		When("someone who is not logged in refreshes the login", async () => {
			await world.anonymous("POST", "/api/v1/auth/refresh");
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
	};
}

const LIMITED_TO_PATH = "the {string} cookie is limited to the path {string}";

// The cookie of that name is sent only to that path, which is what the reply's Path attribute says.
function limitedToPath(world: AuthWorld) {
	return (_ctx: unknown, name: string, path: string) => {
		expect(world.pathOf(name)).toBe(path);
	};
}

// The refresh cookie reaches the auth routes alone, and the access cookie reaches every route.
function cookieLimitedToAuth(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, Then, And }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		Then(LIMITED_TO_PATH, limitedToPath(world));
		And(LIMITED_TO_PATH, limitedToPath(world));
	};
}

function routesNeedLogin(newWorld: () => AuthWorld): OutlineBinder {
	return ({ When, Then, And }, examples) => {
		const world = newWorld();

		When("someone who is not logged in sends <method> <path>", async () => {
			await world.anonymous(
				examples.method === "POST" ? "POST" : "GET",
				String(examples.path),
			);
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
	};
}

// The steps of each scenario in the sessions feature, by the scenario's name in the feature's own words.
export function bindAuthSessions(newWorld: () => AuthWorld) {
	return {
		asksLoggedIn: asksLoggedIn(newWorld),
		logsOutEnds: logsOutEnds(newWorld),
		logsOutTwice: logsOutTwice(newWorld),
		refusesExpiredAccess: refusesExpiredAccess(newWorld),
		refreshTrades: refreshTrades(newWorld),
		refreshTwiceEnds: refreshTwiceEnds(newWorld),
		refreshWithoutToken: refreshWithoutToken(newWorld),
		cookieLimitedToAuth: cookieLimitedToAuth(newWorld),
		routesNeedLogin: routesNeedLogin(newWorld),
	};
}
