import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { buildConfig, type Config } from "../config.js";
import { specFile } from "./support/paths.js";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/config/environment.feature")),
	({ Scenario, ScenarioOutline }) => {
		Scenario(
			"Local defaults apply outside production",
			({ Given, When, Then, And }) => {
				let env: NodeJS.ProcessEnv = {};
				let config: Config;

				Given("NODE_ENV is not production", () => {
					env = { NODE_ENV: "development" };
				});

				When("the configuration is built from an empty environment", () => {
					config = buildConfig(env);
				});

				Then("the port is 8080", () => {
					expect(config.port).toBe(8080);
				});

				And("the database URL points at localhost port 5432", () => {
					expect(new URL(config.databaseUrl).port).toBe("5432");
					expect(new URL(config.databaseUrl).hostname).toBe("localhost");
				});

				And('the Redis URL is "redis://localhost:6379"', () => {
					expect(config.redisUrl).toBe("redis://localhost:6379");
				});
			},
		);

		Scenario(
			"Production requires DATABASE_URL",
			({ Given, And, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let error: unknown;

				Given("NODE_ENV is production", () => {
					env = { NODE_ENV: "production" };
				});

				And("REDIS_URL is set", () => {
					env.REDIS_URL = "redis://cache:6379";
				});

				When("the configuration is built", () => {
					try {
						buildConfig(env);
					} catch (caught) {
						error = caught;
					}
				});

				Then(
					'building the configuration fails with "DATABASE_URL is required in production"',
					() => {
						expect((error as Error).message).toBe(
							"DATABASE_URL is required in production",
						);
					},
				);
			},
		);

		Scenario("Production requires REDIS_URL", ({ Given, And, When, Then }) => {
			let env: NodeJS.ProcessEnv = {};
			let error: unknown;

			Given("NODE_ENV is production", () => {
				env = { NODE_ENV: "production" };
			});

			And("DATABASE_URL is set", () => {
				env.DATABASE_URL = "postgres://u:p@db:5432/x";
			});

			When("the configuration is built", () => {
				try {
					buildConfig(env);
				} catch (caught) {
					error = caught;
				}
			});

			Then(
				'building the configuration fails with "REDIS_URL is required in production"',
				() => {
					expect((error as Error).message).toBe(
						"REDIS_URL is required in production",
					);
				},
			);
		});

		Scenario(
			"Configured values are read from the environment",
			({ Given, And, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let config: Config;

				Given('FLASH_BE_PORT is "9000"', () => {
					env = { FLASH_BE_PORT: "9000" };
				});

				And('DATABASE_URL is "postgres://u:p@db:5432/x"', () => {
					env.DATABASE_URL = "postgres://u:p@db:5432/x";
				});

				And('REDIS_URL is "redis://cache:6379"', () => {
					env.REDIS_URL = "redis://cache:6379";
				});

				When("the configuration is built", () => {
					config = buildConfig(env);
				});

				Then("the port is 9000", () => {
					expect(config.port).toBe(9000);
				});

				And('the database URL is "postgres://u:p@db:5432/x"', () => {
					expect(config.databaseUrl).toBe("postgres://u:p@db:5432/x");
				});

				And('the Redis URL is "redis://cache:6379"', () => {
					expect(config.redisUrl).toBe("redis://cache:6379");
				});
			},
		);

		// One row per Examples value in the feature. Each row runs as its own set of tests.
		ScenarioOutline(
			"Invalid FLASH_BE_PORT is refused",
			({ Given, When, Then }, examples) => {
				let env: NodeJS.ProcessEnv = {};
				let error: unknown;

				Given('FLASH_BE_PORT is "<value>"', () => {
					env = { FLASH_BE_PORT: examples.value };
				});

				When("the configuration is built", () => {
					try {
						buildConfig(env);
					} catch (caught) {
						error = caught;
					}
				});

				Then(
					'building the configuration fails with "FLASH_BE_PORT must be a valid port number"',
					() => {
						expect((error as Error).message).toBe(
							"FLASH_BE_PORT must be a valid port number",
						);
					},
				);
			},
		);
	},
);
