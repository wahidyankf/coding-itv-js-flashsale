// Unit tests for the first steps of the server: the config line is written before Redis is connected.
import { describe, expect, it } from "vitest";
import type { LogFields } from "./application/ports/logger.js";
import { buildConfig, configFields } from "./config.js";
import { announceThenConnect } from "./startup.js";

describe("announceThenConnect", () => {
	it("writes the config line before it connects to Redis, and returns the client", async () => {
		const config = buildConfig({ REDIS_URL: "redis://cache:6379" });
		const calls: string[] = [];
		const written: LogFields[] = [];
		const client = await announceThenConnect(
			config,
			{
				info: (fields, message) => {
					written.push(fields);
					calls.push(`log ${message}`);
				},
			},
			async (url) => {
				calls.push(`connect ${url}`);
				return "the client";
			},
		);
		expect(calls).toEqual([
			"log flash-be config",
			"connect redis://cache:6379",
		]);
		expect(written).toEqual([configFields(config)]);
		expect(client).toBe("the client");
	});

	// The case the line is for: a connect that never ends. The line is already out.
	it("has written the config line while the connect still waits", () => {
		const calls: string[] = [];
		void announceThenConnect(
			buildConfig({}),
			{ info: (_fields, message) => calls.push(`log ${message}`) },
			() => new Promise<never>(() => {}),
		);
		expect(calls).toEqual(["log flash-be config"]);
	});
});
