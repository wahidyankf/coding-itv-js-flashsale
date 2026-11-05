import { describe, expect, it } from "vitest";
import { buildConfig } from "./config.js";

describe("buildConfig", () => {
	it("uses local defaults outside production", () => {
		const config = buildConfig({});

		expect(config.host).toBe("0.0.0.0");
		expect(config.port).toBe(8080);
		expect(config.databaseUrl).toContain("localhost:5432");
		expect(config.redisUrl).toBe("redis://localhost:6379");
	});

	it("reads the port and URLs from env", () => {
		const config = buildConfig({
			FLASH_BE_PORT: "9000",
			DATABASE_URL: "postgres://u:p@db:5432/x",
			REDIS_URL: "redis://cache:6379",
		});

		expect(config.port).toBe(9000);
		expect(config.databaseUrl).toBe("postgres://u:p@db:5432/x");
		expect(config.redisUrl).toBe("redis://cache:6379");
	});

	it("requires DATABASE_URL in production", () => {
		expect(() =>
			buildConfig({ NODE_ENV: "production", REDIS_URL: "redis://x" }),
		).toThrow("DATABASE_URL is required in production");
	});

	it("rejects an invalid port", () => {
		expect(() => buildConfig({ FLASH_BE_PORT: "99999" })).toThrow(
			"FLASH_BE_PORT",
		);
		expect(() => buildConfig({ FLASH_BE_PORT: "abc" })).toThrow(
			"FLASH_BE_PORT",
		);
	});
});
