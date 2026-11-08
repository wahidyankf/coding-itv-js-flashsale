// The steps of specs/apps/flash/be/behaviours/auth/sessions.feature, as both layers bind them. Each scenario gets the auth
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { API_PATHS } from "@flash/flash-commons";
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
const CLEARS_COOKIES = "the reply clears both cookies";

// The reply ends both session cookies, so the browser stops sending them.
function clearsCookies(world: AuthWorld) {
	return () => {
		expect(world.setCookies).toHaveLength(2);
		for (const cookie of world.setCookies) {
			expect(cookie).toContain("Max-Age=0");
		}
	};
}

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
		And(CLEARS_COOKIES, clearsCookies(world));
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
		And(CLEARS_COOKIES, clearsCookies(world));
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
			await world.anonymous("POST", API_PATHS.authRefresh);
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
		And(CLEARS_COOKIES, clearsCookies(world));
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

const TWO_INSTANCES =
	"two instances of the API share one database and one Redis";
const SIGNED_UP_ON_FIRST =
	"{string} has signed up with the password {string} on the first instance";

// Both layers build the second instance with the world, over the same stores, so there is nothing more to start.
const twoInstances = () => {};

function loginAcrossInstances(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(TWO_INSTANCES, twoInstances);
		And(
			"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour",
			async () => {
				await world.openSale();
			},
		);
		And(SIGNED_UP_ON_FIRST, signedUp(world));
		When(
			"the shopper asks who is logged in on the second instance",
			async () => {
				await world.me("second");
			},
		);
		Then("the response status is {int}", statusIs(world));
		And("the account is {string}, a {string}", account(world));
		When("the shopper joins the queue on the second instance", async () => {
			await world.joinQueue("second");
		});
		// A second check of the status, bound by its exact text so it finds its own line.
		Then("the response status is 201", () => {
			expect(world.response.statusCode).toBe(201);
		});
	};
}

function logoutAcrossInstances(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(TWO_INSTANCES, twoInstances);
		And(SIGNED_UP_ON_FIRST, signedUp(world));
		And(COPY, keepsCopy(world));
		// The second instance answers once first, so the login is in the shared cache when the first instance ends it.
		And(
			"the shopper has asked who is logged in on the second instance",
			async () => {
				expect((await world.me("second")).statusCode).toBe(200);
			},
		);
		When("the shopper logs out on the first instance", async () => {
			await world.logOut("first");
		});
		And(
			"the copy of the access token is sent to the second instance",
			async () => {
				await world.meWithCopy("second");
			},
		);
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
	};
}

function refreshAcrossInstances(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(TWO_INSTANCES, twoInstances);
		And(SIGNED_UP_ON_FIRST, signedUp(world));
		And(COPY, keepsCopy(world));
		When("the shopper refreshes the login on the first instance", async () => {
			expect((await world.refresh("first")).statusCode).toBe(200);
		});
		And(
			"the shopper asks who is logged in on the second instance",
			async () => {
				await world.me("second");
			},
		);
		Then("the response status is {int}", statusIs(world));
		And("the account is {string}, a {string}", account(world));
		When(
			"the copy of the refresh token is used on the second instance",
			async () => {
				await world.refreshWithCopy("second");
			},
		);
		Then("the response status is 401", () => {
			expect(world.response.statusCode).toBe(401);
		});
		And("the error is {string}", errorIs(world));
		And(
			"the shopper is no longer logged in on the second instance",
			async () => {
				expect((await world.me("second")).statusCode).toBe(401);
			},
		);
	};
}

// The refresh token runs out, as its 7 days do. The refresh is refused, and the session row is left open: nothing ends it.
function refusesExpiredRefresh(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		And(COPY, keepsCopy(world));
		When("the refresh token runs out", async () => {
			await world.expireRefresh();
		});
		And("the shopper refreshes the login", async () => {
			await world.refresh();
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
		And(CLEARS_COOKIES, clearsCookies(world));
		And("the session of the copied tokens is not ended", async () => {
			expect(await world.copyIsLive()).toBe(true);
		});
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
		refusesExpiredRefresh: refusesExpiredRefresh(newWorld),
		cookieLimitedToAuth: cookieLimitedToAuth(newWorld),
		routesNeedLogin: routesNeedLogin(newWorld),
		loginAcrossInstances: loginAcrossInstances(newWorld),
		logoutAcrossInstances: logoutAcrossInstances(newWorld),
		refreshAcrossInstances: refreshAcrossInstances(newWorld),
	};
}
