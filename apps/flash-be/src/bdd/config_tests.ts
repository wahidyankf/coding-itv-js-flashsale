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

				And("the database host is localhost on port 5432", () => {
					expect(new URL(config.databaseUrl).hostname).toBe("localhost");
					expect(new URL(config.databaseUrl).port).toBe("5432");
				});

				And("the Redis host is localhost on port 6379", () => {
					expect(new URL(config.redisUrl).hostname).toBe("localhost");
					expect(new URL(config.redisUrl).port).toBe("6379");
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
			"Production requires TICKET_SECRET",
			({ Given, And, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let error: unknown;

				Given("NODE_ENV is production", () => {
					env = { NODE_ENV: "production" };
				});

				And("DATABASE_URL is set", () => {
					env.DATABASE_URL = "postgres://u:p@db:5432/x";
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
					'building the configuration fails with "TICKET_SECRET is required in production"',
					() => {
						expect((error as Error).message).toBe(
							"TICKET_SECRET is required in production",
						);
					},
				);
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

		ScenarioOutline(
			"Invalid queue timings are refused",
			({ Given, When, Then }, examples) => {
				let env: NodeJS.ProcessEnv = {};
				let error: unknown;

				Given('<name> is "<value>"', () => {
					env = { [String(examples.name)]: String(examples.value) };
				});

				When("the configuration is built", () => {
					try {
						buildConfig(env);
					} catch (caught) {
						error = caught;
					}
				});

				Then(
					'building the configuration fails with "<name> must be a positive integer"',
					() => {
						expect((error as Error).message).toBe(
							`${examples.name} must be a positive integer`,
						);
					},
				);
			},
		);

		Scenario(
			"Payment defaults apply outside production",
			({ Given, When, Then, And }) => {
				let env: NodeJS.ProcessEnv = {};
				let config: Config;

				Given("NODE_ENV is not production", () => {
					env = { NODE_ENV: "development" };
				});

				When("the configuration is built from an empty environment", () => {
					config = buildConfig(env);
				});

				Then("the payment takes {int} ms", (_ctx, ms: number) => {
					expect(config.paymentLatencyMs).toBe(ms);
				});

				And(
					"the payment declines {int} percent of charges",
					(_ctx, percent: number) => {
						expect(config.paymentFailureRate * 100).toBeCloseTo(percent);
					},
				);
			},
		);

		ScenarioOutline(
			"Invalid payment settings are refused",
			({ Given, When, Then }, examples) => {
				let env: NodeJS.ProcessEnv = {};
				let error: unknown;

				Given('<name> is "<value>"', () => {
					env = { [String(examples.name)]: String(examples.value) };
				});

				When("the configuration is built", () => {
					try {
						buildConfig(env);
					} catch (caught) {
						error = caught;
					}
				});

				Then('building the configuration fails with "<name> <rule>"', () => {
					expect((error as Error).message).toBe(
						`${examples.name} ${examples.rule}`,
					);
				});
			},
		);

		Scenario(
			"Configured port is read from the environment",
			({ Given, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let config: Config;

				Given('FLASH_BE_PORT is "9000"', () => {
					env = { FLASH_BE_PORT: "9000" };
				});

				When("the configuration is built", () => {
					config = buildConfig(env);
				});

				Then("the port is 9000", () => {
					expect(config.port).toBe(9000);
				});
			},
		);

		Scenario(
			"Configured database and Redis hosts are read from the environment",
			({ Given, And, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let config: Config;

				Given('DATABASE_URL is "postgres://u:p@db:5432/x"', () => {
					env = { DATABASE_URL: "postgres://u:p@db:5432/x" };
				});

				And('REDIS_URL is "redis://cache:6379"', () => {
					env.REDIS_URL = "redis://cache:6379";
				});

				When("the configuration is built", () => {
					config = buildConfig(env);
				});

				Then("the database host is db on port 5432", () => {
					expect(new URL(config.databaseUrl).hostname).toBe("db");
					expect(new URL(config.databaseUrl).port).toBe("5432");
				});

				And("the Redis host is cache on port 6379", () => {
					expect(new URL(config.redisUrl).hostname).toBe("cache");
					expect(new URL(config.redisUrl).port).toBe("6379");
				});
			},
		);
	},
);
