// Unit tests for the config: the backend address comes from the environment, with a local default.
import { expect, it } from "vitest";
import { buildConfig } from "./config";

// Only a developer sees how the address is read, so this is a plain test and not a scenario.
it("defaults the backend URL to the local flash-be port", () => {
	expect(buildConfig({}).backendUrl).toBe("http://localhost:8080");
});

it("reads the backend URL from FLASH_BE_URL", () => {
	expect(buildConfig({ FLASH_BE_URL: "http://flash-be:8080" }).backendUrl).toBe(
		"http://flash-be:8080",
	);
});
