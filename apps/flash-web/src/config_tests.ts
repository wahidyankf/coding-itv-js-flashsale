import { describe, expect, it } from "vitest";
import { buildConfig } from "./config";

describe("buildConfig", () => {
	it("defaults the backend URL to the local flash-be port", () => {
		expect(buildConfig({}).backendUrl).toBe("http://localhost:8080");
	});

	it("reads FLASH_BE_URL from env", () => {
		expect(
			buildConfig({ FLASH_BE_URL: "http://flash-be:8080" }).backendUrl,
		).toBe("http://flash-be:8080");
	});
});
