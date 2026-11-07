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
	{ cookieSecure: false },
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
	({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
		BeforeEachScenario(async () => {
			await resetSales(db);
		});

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
