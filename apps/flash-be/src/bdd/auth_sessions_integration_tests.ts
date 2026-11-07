import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { sql } from "kysely";
import { afterAll, expect } from "vitest";
import { buildApp } from "../adapters/inbound/http/app.js";
import { createDb } from "../adapters/outbound/postgres/database.js";
import { createRedis } from "../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../composition.js";
import { config } from "../config.js";
import { hashToken } from "../domain/auth.js";
import { authWorld } from "./support/auth-world.js";
import { specFile } from "./support/paths.js";
import { resetSales } from "./support/seed.js";

// The run database is migrated once by the global setup. Each scenario empties the tables first.
const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const app = buildApp(
	dependenciesFrom(db, redis, {
		...config,
		saleCacheMs: 0,
		// Every scenario signs up from the same address, and the limit has its own scenarios.
		authRateLimitPerIp: 100_000,
	}),
);

afterAll(async () => {
	await app.close();
	await redis.close();
	await db.destroy();
});

// One scenario over the real database, with real password hashing and the Redis cache of logins.
function newWorld() {
	return authWorld({
		app: () => app,
		// The 15 minutes pass: the row says so, and so must the cache, which would otherwise answer for up to a minute.
		expireAccess: async (accessToken) => {
			const hash = hashToken(accessToken);
			await sql`update sessions set access_expires_at = now() - interval '1 minute' where access_hash = ${hash}`.execute(
				db,
			);
			await redis.del(`session:${hash}`);
		},
		stored: async () => {
			const users = await db
				.selectFrom("users")
				.select("password_hash")
				.where("password_hash", "is not", null)
				.execute();
			const sessions = await db
				.selectFrom("sessions")
				.select(["access_hash", "refresh_hash"])
				.execute();
			return {
				passwordHashes: users.flatMap((row) =>
					row.password_hash === null ? [] : [row.password_hash],
				),
				tokenHashes: sessions.flatMap((row) => [
					row.access_hash,
					row.refresh_hash,
				]),
			};
		},
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
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

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
