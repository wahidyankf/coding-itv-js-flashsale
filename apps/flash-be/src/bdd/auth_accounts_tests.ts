import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { MS_PER_MINUTE } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createScryptHasher } from "../adapters/outbound/crypto/scrypt-hasher.js";
import { authWorld } from "./support/auth-world.js";
import { healthyDeps } from "./support/deps.js";
import { memoryAuth } from "./support/memory-auth.js";
import { specFile } from "./support/paths.js";

// Past the 15 minutes of an access token.
const PAST_ACCESS_MS = 16 * MS_PER_MINUTE;

const apps: FastifyInstance[] = [];
afterAll(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

// One scenario in memory: accounts and logins in memory, and a clock the scenario moves.
function newWorld() {
	let now = new Date("2026-06-01T12:00:00Z");
	const auth = memoryAuth(() => now, createScryptHasher());
	const app = buildApp({ ...healthyDeps, auth: auth.service });
	apps.push(app);
	return authWorld({
		app: () => app,
		expireAccess: async () => {
			now = new Date(now.getTime() + PAST_ACCESS_MS);
		},
		stored: async () => auth.stored(),
	});
}

type World = ReturnType<typeof newWorld>;

const SIGN_UP = "{string} signs up with the password {string}";
const SIGNED_UP = "{string} has signed up with the password {string}";
const LOG_IN = "{string} logs in with the password {string}";
const COOKIES =
	"the reply sets an {string} cookie and a {string} cookie, both HttpOnly";
const LOGGED_IN_AS = "the shopper is logged in as {string}";

const signUp =
	(world: World) => async (_ctx: unknown, name: string, password: string) => {
		await world.signUp(name, password);
	};
const signedUp =
	(world: World) => async (_ctx: unknown, name: string, password: string) => {
		expect((await world.signUp(name, password)).statusCode).toBe(201);
	};
const logIn =
	(world: World) => async (_ctx: unknown, name: string, password: string) => {
		await world.logIn(name, password);
	};
const status = (world: World) => (_ctx: unknown, expected: number) => {
	expect(world.response.statusCode).toBe(expected);
};
const error = (world: World) => (_ctx: unknown, expected: string) => {
	expect(world.response.json().errorCode).toBe(expected);
};
const account =
	(world: World) => (_ctx: unknown, name: string, role: string) => {
		expect(world.response.json()).toEqual({ username: name, role });
	};
const cookies =
	(world: World) => (_ctx: unknown, access: string, refresh: string) => {
		for (const name of [access, refresh]) {
			const cookie = world.setCookies.find((c) => c.startsWith(`${name}=`));
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Lax");
		}
	};
const noCookie = (world: World) => () => {
	expect(world.setCookies).toEqual([]);
};
const loggedInAs = (world: World) => async (_ctx: unknown, name: string) => {
	const reply = await world.me();
	expect(reply.statusCode).toBe(200);
	expect(reply.json().username).toBe(name);
};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/accounts.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"A new shopper signs up and is logged in",
			({ When, Then, And }) => {
				const world = newWorld();
				When(SIGN_UP, signUp(world));
				Then("the response status is {int}", status(world));
				And("the account is {string}, a {string}", account(world));
				And(COOKIES, cookies(world));
				And(LOGGED_IN_AS, loggedInAs(world));
			},
		);

		Scenario(
			"The name is trimmed and lowercased when signing up",
			({ When, Then, And }) => {
				const world = newWorld();
				When(SIGN_UP, signUp(world));
				Then("the response status is {int}", status(world));
				And("the account is {string}, a {string}", account(world));
			},
		);

		ScenarioOutline(
			"A name or a password that cannot be used is refused",
			({ When, Then, And }, examples) => {
				const world = newWorld();
				When('"<name>" signs up with the password "<password>"', async () => {
					await world.signUp(examples.name, examples.password);
				});
				Then("the response status is {int}", status(world));
				And('the error is "<error>"', () => {
					expect(world.response.json().errorCode).toBe(String(examples.error));
				});
				And("the reply sets no cookie", noCookie(world));
			},
		);

		Scenario(
			"A name that is taken is refused, whatever its case",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				When(SIGN_UP, signUp(world));
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
				And("the reply sets no cookie", noCookie(world));
			},
		);

		Scenario(
			"A shopper logs in with the right password",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				When(LOG_IN, logIn(world));
				Then("the response status is {int}", status(world));
				And(COOKIES, cookies(world));
				And(LOGGED_IN_AS, loggedInAs(world));
			},
		);

		ScenarioOutline(
			"A wrong password and an unknown name are refused in the same way",
			({ Given, When, Then, And }, examples) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				When('"<name>" logs in with the password "<password>"', async () => {
					await world.logIn(examples.name, examples.password);
				});
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
				And("the reply sets no cookie", noCookie(world));
			},
		);

		Scenario("Only a hash of the password is stored", ({ When, Then, And }) => {
			const world = newWorld();
			When(SIGN_UP, signUp(world));
			Then(
				"the stored passwords do not contain {string}",
				async (_ctx, password: string) => {
					const { passwordHashes } = await world.stored();
					expect(passwordHashes.length).toBeGreaterThan(0);
					for (const hash of passwordHashes)
						expect(hash).not.toContain(password);
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
		});
	},
);
