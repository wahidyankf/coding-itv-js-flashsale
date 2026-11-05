import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { buildConfig } from "../config";
import { specFile } from "./support/paths";

describeFeature(
	await loadFeature(
		specFile("flash/web/behaviours/config/backend-url.feature"),
	),
	({ Scenario }) => {
		Scenario(
			"Backend URL defaults to the local flash-be port",
			({ Given, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let url: string;

				Given("FLASH_BE_URL is not set", () => {
					env = {};
				});

				When("the backend URL is read", () => {
					url = buildConfig(env).backendUrl;
				});

				Then('the backend URL is "http://localhost:8080"', () => {
					expect(url).toBe("http://localhost:8080");
				});
			},
		);

		Scenario(
			"Backend URL is read from FLASH_BE_URL",
			({ Given, When, Then }) => {
				let env: NodeJS.ProcessEnv = {};
				let url: string;

				Given('FLASH_BE_URL is "http://flash-be:8080"', () => {
					env = { FLASH_BE_URL: "http://flash-be:8080" };
				});

				When("the backend URL is read", () => {
					url = buildConfig(env).backendUrl;
				});

				Then('the backend URL is "http://flash-be:8080"', () => {
					expect(url).toBe("http://flash-be:8080");
				});
			},
		);
	},
);
