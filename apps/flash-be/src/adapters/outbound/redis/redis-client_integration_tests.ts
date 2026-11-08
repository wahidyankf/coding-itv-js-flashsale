// The Redis client against a real Redis, watched from before its first connect: a connect that works writes no line.
// Adapter layer (integration test: it needs the dev compose stack).
import { expect, it } from "vitest";
import { config } from "../../../config.js";
import { createRedis } from "./redis-client.js";

it("connects with a log and writes no line when the first connect works", async () => {
	const lines: string[] = [];
	const record = (_fields: unknown, message: string): void => {
		lines.push(message);
	};
	const redis = await createRedis(config.redisUrl, {
		debug: record,
		info: record,
		warn: record,
		error: record,
	});
	expect(await redis.ping()).toBe("PONG");
	await redis.close();
	expect(lines).toEqual([]);
});
