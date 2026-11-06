import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfig, describeConfig } from "./config.js";

// How the environment becomes a Config is a detail of the code, so it is checked here and not with scenarios.
const hostAndPort = (url: string) => {
	const parsed = new URL(url);
	return `${parsed.hostname}:${parsed.port}`;
};

describe("local defaults", () => {
	const config = buildConfig({ NODE_ENV: "development" });

	it("point at the local stack", () => {
		expect(config.port).toBe(8080);
		expect(hostAndPort(config.databaseUrl)).toBe("localhost:5432");
		expect(hostAndPort(config.redisUrl)).toBe("localhost:6379");
	});

	it("set the payment, the rate limit, the cache and the event interval", () => {
		expect(config.paymentLatencyMs).toBe(150);
		expect(config.paymentFailureRate).toBeCloseTo(0.02);
		expect(config.rateLimitPerUser).toBe(30);
		expect(config.rateLimitPerIp).toBe(600);
		expect(config.rateLimitWindowSeconds).toBe(10);
		expect(config.trustProxy).toBe(false);
		expect(config.saleCacheMs).toBe(1000);
		expect(config.eventsIntervalMs).toBe(1000);
	});
});

describe("production", () => {
	const complete: Record<string, string> = {
		NODE_ENV: "production",
		DATABASE_URL: "postgres://u:p@db:5432/x",
		REDIS_URL: "redis://cache:6379",
		TICKET_SECRET: "secret",
	};

	it.each(["DATABASE_URL", "REDIS_URL", "TICKET_SECRET"])(
		"requires %s",
		(name) => {
			const env = Object.fromEntries(
				Object.entries(complete).filter(([key]) => key !== name),
			);
			expect(() => buildConfig(env)).toThrow(
				`${name} is required in production`,
			);
		},
	);
});

describe("values from the environment", () => {
	it("reads the port, the database and Redis", () => {
		const config = buildConfig({
			FLASH_BE_PORT: "9000",
			DATABASE_URL: "postgres://u:p@db:5432/x",
			REDIS_URL: "redis://cache:6379",
		});
		expect(config.port).toBe(9000);
		expect(hostAndPort(config.databaseUrl)).toBe("db:5432");
		expect(hostAndPort(config.redisUrl)).toBe("cache:6379");
	});

	it("reads the payment, the rate limit, the cache and the event interval", () => {
		const config = buildConfig({
			PAYMENT_LATENCY_MS: "0",
			PAYMENT_FAILURE_RATE: "0.5",
			RATE_LIMIT_WINDOW_SECONDS: "5",
			RATE_LIMIT_PER_USER: "7",
			RATE_LIMIT_PER_IP: "70",
			SALE_CACHE_MS: "0",
			EVENTS_INTERVAL_MS: "250",
			ADMISSION_TICK_MS: "100",
			ADMISSION_TTL_SECONDS: "30",
		});
		expect(config).toMatchObject({
			paymentLatencyMs: 0,
			paymentFailureRate: 0.5,
			rateLimitWindowSeconds: 5,
			rateLimitPerUser: 7,
			rateLimitPerIp: 70,
			saleCacheMs: 0,
			eventsIntervalMs: 250,
			admissionTickMs: 100,
			admissionTtlSeconds: 30,
		});
	});
});

describe("invalid values", () => {
	it.each([
		["FLASH_BE_PORT", "abc", "must be a valid port number"],
		["FLASH_BE_PORT", "0", "must be a valid port number"],
		["FLASH_BE_PORT", "99999", "must be a valid port number"],
		["ADMISSION_TICK_MS", "0", "must be a positive integer"],
		["ADMISSION_TICK_MS", "fast", "must be a positive integer"],
		["ADMISSION_TTL_SECONDS", "-5", "must be a positive integer"],
		["PAYMENT_FAILURE_RATE", "2", "must be a number from 0 to 1"],
		["PAYMENT_FAILURE_RATE", "lots", "must be a number from 0 to 1"],
		["PAYMENT_LATENCY_MS", "-1", "must be zero or a positive integer"],
		["PAYMENT_LATENCY_MS", "slow", "must be zero or a positive integer"],
		["RATE_LIMIT_WINDOW_SECONDS", "0", "must be a positive integer"],
		["RATE_LIMIT_PER_USER", "abc", "must be a positive integer"],
		["RATE_LIMIT_PER_IP", "-1", "must be a positive integer"],
		["TRUST_PROXY", "maybe", "must be true or false"],
		["SALE_CACHE_MS", "abc", "must be zero or a positive integer"],
		["SALE_CACHE_MS", "-1", "must be zero or a positive integer"],
		["SALE_CACHE_MS", "1.5", "must be zero or a positive integer"],
		["EVENTS_INTERVAL_MS", "0", "must be a positive integer"],
		["EVENTS_INTERVAL_MS", "abc", "must be a positive integer"],
		["EVENTS_INTERVAL_MS", "-5", "must be a positive integer"],
	])("refuses %s=%s", (name, value, rule) => {
		expect(() => buildConfig({ [name]: value })).toThrow(`${name} ${rule}`);
	});
});

// The startup line is read by the e2e suite. It must show host and port and never a password.
it("describeConfig shows host and port without credentials", () => {
	const line = describeConfig(
		buildConfig({
			FLASH_BE_PORT: "9000",
			DATABASE_URL: "postgres://u:secret@db:5432/x",
			REDIS_URL: "redis://cache:6379",
		}),
	);
	expect(line).toBe(
		"flash-be config: port=9000 database=db:5432 redis=cache:6379 payment=150ms/0.02 limit=30/600/10s cache=1000ms events=1000ms proxy=false admin=off",
	);
	expect(line).not.toContain("secret");
});

it("reads TRUST_PROXY as a true or false flag", () => {
	expect(buildConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
	expect(buildConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
	expect(buildConfig({ TRUST_PROXY: "" }).trustProxy).toBe(false);
	expect(() => buildConfig({ TRUST_PROXY: "yes" })).toThrow(
		"TRUST_PROXY must be true or false",
	);
});

describe("the admin token", () => {
	const token = "operator-secret-0001";

	it("is off when ADMIN_TOKEN is missing or empty", () => {
		expect(buildConfig({}).adminToken).toBeUndefined();
		expect(buildConfig({ ADMIN_TOKEN: "" }).adminToken).toBeUndefined();
	});

	it("is read when it is long enough, and shown only as on", () => {
		const config = buildConfig({ ADMIN_TOKEN: token });
		expect(config.adminToken).toBe(token);
		const line = describeConfig(config);
		expect(line).toContain("admin=on");
		expect(line).not.toContain(token);
	});

	it("refuses a token that is too short to resist guessing", () => {
		expect(() => buildConfig({ ADMIN_TOKEN: "short" })).toThrow(
			"ADMIN_TOKEN must be at least 16 characters",
		);
	});
});

// .env.example is what a new developer copies, so it must say what the code does when a setting is absent.
describe(".env.example", () => {
	const example = Object.fromEntries(
		readFileSync(
			path.resolve(import.meta.dirname, "../../../.env.example"),
			"utf8",
		)
			.split("\n")
			.filter((line) => /^[A-Z_]+=/.test(line))
			.map((line) => {
				const at = line.indexOf("=");
				return [line.slice(0, at), line.slice(at + 1)];
			}),
	);

	it("gives every setting the value the code uses when it is absent", () => {
		expect(buildConfig(example)).toEqual(buildConfig({}));
	});

	it("leaves the admin token empty, so no secret is committed", () => {
		expect(example.ADMIN_TOKEN).toBe("");
	});
});
