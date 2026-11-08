// The steps of specs/apps/flash/be/behaviours/auth/accounts.feature, as both layers bind them. Each scenario gets the auth
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

const SIGN_UP = "{string} signs up with the password {string}";
const LOG_IN = "{string} logs in with the password {string}";
const SIGNED_UP = "{string} has signed up with the password {string}";
const COOKIES =
	"the reply sets an {string} cookie and a {string} cookie, both HttpOnly";
const LOGGED_IN_AS = "the shopper is logged in as {string}";

// Both session cookies must be HttpOnly and SameSite=Lax, as the rules require.
function cookies(world: AuthWorld) {
	return (_ctx: unknown, access: string, refresh: string) => {
		for (const name of [access, refresh]) {
			const cookie = world.setCookies.find((c) => c.startsWith(`${name}=`));
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Lax");
		}
	};
}

// The body of the account the reply shows: its name and its role, and nothing else.
function account(world: AuthWorld) {
	return (_ctx: unknown, name: string, role: string) => {
		expect(responseOf(world).json()).toEqual({ username: name, role });
	};
}

function noCookie(world: AuthWorld) {
	return () => {
		expect(world.setCookies).toEqual([]);
	};
}

function signsUpAndLogsIn(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();

		When(SIGN_UP, async (_ctx, name: string, password: string) => {
			await world.signUp(name, password);
		});
		Then("the response status is {int}", statusIs(world));
		And("the account is {string}, a {string}", account(world));
		And(COOKIES, cookies(world));
		And(LOGGED_IN_AS, loggedInAs(world));
	};
}

function trimsName(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();

		When(SIGN_UP, async (_ctx, name: string, password: string) => {
			await world.signUp(name, password);
		});
		Then("the response status is {int}", statusIs(world));
		And("the account is {string}, a {string}", account(world));
	};
}

function refusesUnusable(newWorld: () => AuthWorld): OutlineBinder {
	return ({ When, Then, And }, examples) => {
		const world = newWorld();

		When('"<name>" signs up with the password "<password>"', async () => {
			await world.signUp(examples.name, examples.password);
		});
		Then("the response status is {int}", statusIs(world));
		And('the error is "<error>"', () => {
			expect(responseOf(world).json().errorCode).toBe(String(examples.error));
		});
		And("the reply sets no cookie", noCookie(world));
	};
}

function nameTaken(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When(SIGN_UP, async (_ctx, name: string, password: string) => {
			await world.signUp(name, password);
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
		And("the reply sets no cookie", noCookie(world));
	};
}

function logsIn(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When(LOG_IN, async (_ctx, name: string, password: string) => {
			await world.logIn(name, password);
		});
		Then("the response status is {int}", statusIs(world));
		And(COOKIES, cookies(world));
		And(LOGGED_IN_AS, loggedInAs(world));
	};
}

function refusesWrongLogin(newWorld: () => AuthWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();

		Given(SIGNED_UP, signedUp(world));
		When('"<name>" logs in with the password "<password>"', async () => {
			await world.logIn(examples.name, examples.password);
		});
		Then("the response status is {int}", statusIs(world));
		And("the error is {string}", errorIs(world));
		And("the reply sets no cookie", noCookie(world));
	};
}

function hashesOnly(newWorld: () => AuthWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();

		When(SIGN_UP, async (_ctx, name: string, password: string) => {
			await world.signUp(name, password);
		});
		Then(
			"the stored passwords do not contain {string}",
			async (_ctx, password: string) => {
				const { passwordHashes } = await world.stored();
				expect(passwordHashes.length).toBeGreaterThan(0);
				for (const hash of passwordHashes) expect(hash).not.toContain(password);
			},
		);
		And(
			"the stored logins hold hashes of the tokens, not the tokens",
			async () => {
				const { tokenHashes } = await world.stored();
				expect(tokenHashes.length).toBeGreaterThan(0);
				for (const token of world.tokens) {
					expect(tokenHashes).not.toContain(token);
				}
			},
		);
	};
}

// The steps of each scenario in the accounts feature, by the scenario's name in the feature's own words.
export function bindAuthAccounts(newWorld: () => AuthWorld) {
	return {
		signsUpAndLogsIn: signsUpAndLogsIn(newWorld),
		trimsName: trimsName(newWorld),
		refusesUnusable: refusesUnusable(newWorld),
		nameTaken: nameTaken(newWorld),
		logsIn: logsIn(newWorld),
		refusesWrongLogin: refusesWrongLogin(newWorld),
		hashesOnly: hashesOnly(newWorld),
	};
}
