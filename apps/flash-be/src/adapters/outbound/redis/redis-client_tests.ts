// The Redis client's reconnect policy, as pure functions: the wait before each try, and no point at which it gives up. And
// the log of the connection: one line when it is lost and one when it is back, not one per failed command.
import { EventEmitter } from "node:events";
import { SocketTimeoutError } from "@redis/client";
import { describe, expect, it } from "vitest";
import type { LogFields } from "../../../application/ports/logger.js";
import {
	reconnectDelayMs,
	reconnectStrategy,
	watchConnection,
} from "./redis-client.js";

// A draw of one half takes half of each bound, so each wait below is easy to read.
const HALF = () => 0.5;

describe("reconnectDelayMs", () => {
	it("starts at a 50 ms bound and doubles it, with full jitter", () => {
		expect(reconnectDelayMs(0, HALF)).toBe(25);
		expect(reconnectDelayMs(1, HALF)).toBe(50);
		expect(reconnectDelayMs(2, HALF)).toBe(100);
	});

	it("stops growing at a 2 s bound", () => {
		expect(reconnectDelayMs(20, HALF)).toBe(1000);
	});
});

describe("reconnectStrategy", () => {
	// The API must catch up when Redis returns, so the client keeps trying: there is no give-up answer.
	it("answers with a wait after any number of failed tries", () => {
		const strategy = reconnectStrategy(HALF);
		expect(strategy(0, new Error("refused"))).toBe(25);
		expect(strategy(1_000_000, new Error("refused"))).toBe(1000);
	});

	// node-redis's default answers `false` after a socket timeout and never reconnects. This policy waits instead.
	it("answers with a wait after a socket timeout", () => {
		const strategy = reconnectStrategy(HALF);
		expect(strategy(3, new SocketTimeoutError(1000))).toBe(
			reconnectDelayMs(3, HALF),
		);
	});
});

describe("watchConnection", () => {
	// A logger that keeps each line as its level, message and fields.
	function recording() {
		const lines: Array<{ level: string; message: string; fields: LogFields }> =
			[];
		const at =
			(level: string) =>
			(fields: LogFields, message: string): void => {
				lines.push({ level, message, fields });
			};
		return {
			lines,
			log: {
				debug: at("debug"),
				info: at("info"),
				warn: at("warn"),
				error: at("error"),
			},
		};
	}

	it("logs a lost connection once, however many commands fail, and its return once", () => {
		const client = new EventEmitter();
		const { lines, log } = recording();
		watchConnection(client, log);
		client.emit("ready");
		client.emit("error", new Error("read ECONNRESET"));
		client.emit("error", new Error("connect ECONNREFUSED"));
		client.emit("error", new Error("connect ECONNREFUSED"));
		client.emit("ready");
		client.emit("ready");
		client.emit("error", new Error("read ECONNRESET"));
		expect(lines).toEqual([
			{
				level: "warn",
				message: "redis connection lost",
				fields: { cause: "read ECONNRESET" },
			},
			{ level: "info", message: "redis connection back", fields: {} },
			{
				level: "warn",
				message: "redis connection lost",
				fields: { cause: "read ECONNRESET" },
			},
		]);
	});

	// Watched from before the first connect, so an API that waits on an unreachable Redis says so.
	it("warns once that Redis is not reachable when the first connect fails, and says when it connects", () => {
		const client = new EventEmitter();
		const { lines, log } = recording();
		watchConnection(client, log);
		client.emit("error", new Error("connect ECONNREFUSED"));
		client.emit("error", new Error("connect ECONNREFUSED"));
		client.emit("ready");
		expect(lines).toEqual([
			{
				level: "warn",
				message: "redis not reachable, retrying",
				fields: { cause: "connect ECONNREFUSED" },
			},
			{ level: "info", message: "redis connection back", fields: {} },
		]);
	});

	it("writes nothing when the first connect works", () => {
		const client = new EventEmitter();
		const { lines, log } = recording();
		watchConnection(client, log);
		client.emit("ready");
		expect(lines).toEqual([]);
	});

	it("names a cause that is not an Error", () => {
		const client = new EventEmitter();
		const { lines, log } = recording();
		watchConnection(client, log);
		client.emit("error", "socket closed");
		expect(lines[0]?.fields).toEqual({ cause: "socket closed" });
	});
});
