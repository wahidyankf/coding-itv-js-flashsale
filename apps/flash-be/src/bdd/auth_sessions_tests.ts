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
	const app = buildApp(
		{ ...healthyDeps, auth: auth.service },
		{ cookieSecure: false },
	);
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

const SIGNED_UP = "{string} has signed up with the password {string}";
const COPY = "the shopper keeps a copy of the tokens";
const COPY_REFUSED = "the copy of the access token is refused";
const LOGGED_IN_AS = "the shopper is logged in as {string}";

const signedUp =
	(world: World) => async (_ctx: unknown, name: string, password: string) => {
		expect((await world.signUp(name, password)).statusCode).toBe(201);
	};
const keepsCopy = (world: World) => () => {
	world.keepCopy();
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
const copyRefused = (world: World) => async () => {
	const reply = await world.meWithCopy();
	expect(reply.statusCode).toBe(401);
	expect(reply.json().errorCode).toBe("not_authenticated");
};
const cookies =
	(world: World) => (_ctx: unknown, access: string, refresh: string) => {
		for (const name of [access, refresh]) {
			const cookie = world.setCookies.find((c) => c.startsWith(`${name}=`));
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
		}
	};
const loggedInAs = (world: World) => async (_ctx: unknown, name: string) => {
	const reply = await world.me();
	expect(reply.statusCode).toBe(200);
	expect(reply.json().username).toBe(name);
};

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/auth/sessions.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"A shopper asks who is logged in",
			({ Given, When, Then, And }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				When("the shopper asks who is logged in", async () => {
					await world.me();
				});
				Then("the response status is {int}", status(world));
				And("the account is {string}, a {string}", account(world));
			},
		);

		Scenario("Logging out ends the login", ({ Given, And, When, Then }) => {
			const world = newWorld();
			Given(SIGNED_UP, signedUp(world));
			And(COPY, keepsCopy(world));
			When("the shopper logs out", async () => {
				await world.logOut();
			});
			Then("the response status is {int}", status(world));
			And("the reply clears both cookies", () => {
				expect(world.setCookies).toHaveLength(2);
				for (const cookie of world.setCookies) {
					expect(cookie).toContain("Max-Age=0");
				}
			});
			And(COPY_REFUSED, copyRefused(world));
		});

		Scenario("Logging out twice is harmless", ({ Given, When, And, Then }) => {
			const world = newWorld();
			Given(SIGNED_UP, signedUp(world));
			When("the shopper logs out", async () => {
				await world.logOut();
			});
			And("the shopper logs out", async () => {
				await world.logOut();
			});
			Then("the response status is {int}", status(world));
		});

		Scenario(
			"An access token that has expired is refused",
			({ Given, When, And, Then }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				When("the access token expires", async () => {
					await world.expireAccess();
				});
				And("the shopper asks who is logged in", async () => {
					await world.me();
				});
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
			},
		);

		Scenario(
			"The refresh token trades for a new pair of tokens",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				And(COPY, keepsCopy(world));
				When("the shopper refreshes the login", async () => {
					await world.refresh();
				});
				Then("the response status is {int}", status(world));
				And(
					"the reply sets an {string} cookie and a {string} cookie, both HttpOnly",
					cookies(world),
				);
				And(COPY_REFUSED, copyRefused(world));
				And(LOGGED_IN_AS, loggedInAs(world));
			},
		);

		Scenario(
			"A refresh token used twice ends the login",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				And(COPY, keepsCopy(world));
				And("the shopper refreshes the login", async () => {
					expect((await world.refresh()).statusCode).toBe(200);
				});
				When("the copy of the refresh token is used", async () => {
					await world.refreshWithCopy();
				});
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
				And("the shopper is no longer logged in", async () => {
					const reply = await world.me();
					expect(reply.statusCode).toBe(401);
				});
			},
		);

		Scenario(
			"A refresh without a refresh token is refused",
			({ When, Then, And }) => {
				const world = newWorld();
				When("someone who is not logged in refreshes the login", async () => {
					await world.anonymous("POST", "/auth/refresh");
				});
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
			},
		);

		Scenario(
			"The refresh cookie is sent only to the auth paths",
			({ Given, Then }) => {
				const world = newWorld();
				Given(SIGNED_UP, signedUp(world));
				Then(
					"the {string} cookie is limited to the path {string}",
					(_ctx, name: string, path: string) => {
						expect(world.pathOf(name)).toBe(path);
					},
				);
			},
		);

		ScenarioOutline(
			"The routes of a shopper need a login",
			({ When, Then, And }, examples) => {
				const world = newWorld();
				When("someone who is not logged in sends <method> <path>", async () => {
					await world.anonymous(
						examples.method === "POST" ? "POST" : "GET",
						String(examples.path),
					);
				});
				Then("the response status is {int}", status(world));
				And("the error is {string}", error(world));
			},
		);
	},
);
