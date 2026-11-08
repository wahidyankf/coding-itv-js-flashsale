// Unit tests for config.ts: the local defaults, the production rules, the values read from the environment, and that .env.example matches the code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfig, configFields } from "./config.js";
import { localDefaults } from "./local-defaults.js";

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

	it("log at the info level", () => {
		expect(config.logLevel).toBe("info");
	});

	it("set the drain window and the time limit of a shutdown", () => {
		expect(config.shutdownDrainMs).toBe(2000);
		expect(config.shutdownTimeoutMs).toBe(10_000);
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
			SHUTDOWN_DRAIN_MS: "0",
			SHUTDOWN_TIMEOUT_MS: "5000",
			LOG_LEVEL: "debug",
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
			shutdownDrainMs: 0,
			shutdownTimeoutMs: 5000,
			logLevel: "debug",
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
		["SHUTDOWN_DRAIN_MS", "-1", "must be zero or a positive integer"],
		["SHUTDOWN_DRAIN_MS", "soon", "must be zero or a positive integer"],
		["SHUTDOWN_TIMEOUT_MS", "0", "must be a positive integer"],
		[
			"LOG_LEVEL",
			"verbose",
			"must be one of fatal, error, warn, info, debug, trace, silent",
		],
		[
			"LOG_LEVEL",
			"INFO",
			"must be one of fatal, error, warn, info, debug, trace, silent",
		],
	])("refuses %s=%s", (name, value, rule) => {
		expect(() => buildConfig({ [name]: value })).toThrow(`${name} ${rule}`);
	});
});

// Every level pino knows is accepted, and nothing else, so a typo cannot silence the log.
it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
	"accepts LOG_LEVEL=%s",
	(level) => {
		expect(buildConfig({ LOG_LEVEL: level }).logLevel).toBe(level);
	},
);

// A time limit that the drain window alone uses up would fail every shutdown, so it is refused at start.
it("refuses a shutdown time limit that is not longer than the drain window", () => {
	expect(() =>
		buildConfig({ SHUTDOWN_DRAIN_MS: "3000", SHUTDOWN_TIMEOUT_MS: "3000" }),
	).toThrow("SHUTDOWN_TIMEOUT_MS must be greater than SHUTDOWN_DRAIN_MS");
});

// The startup log line. It must show host and port and never a password or the ticket secret.
it("configFields shows host and port without credentials", () => {
	const fields = configFields(
		buildConfig({
			FLASH_BE_PORT: "9000",
			DATABASE_URL: "postgres://u:secret@db:5432/x",
			REDIS_URL: "redis://:secret@cache:6379",
			TICKET_SECRET: "ticket-secret-value",
		}),
	);
	expect(fields).toEqual({
		port: 9000,
		database: "db:5432",
		redis: "cache:6379",
		paymentLatencyMs: 150,
		paymentFailureRate: 0.02,
		rateLimitPerUser: 30,
		rateLimitPerIp: 600,
		rateLimitWindowSeconds: 10,
		saleCacheMs: 1000,
		eventsIntervalMs: 1000,
		trustProxy: false,
		cookieSecure: false,
		shutdownDrainMs: 2000,
		shutdownTimeoutMs: 10000,
		logLevel: "info",
	});
	const text = JSON.stringify(fields);
	expect(text).not.toContain("secret");
	expect(text).not.toContain("u:");
});

it("reads TRUST_PROXY as a true or false flag", () => {
	expect(buildConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
	expect(buildConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
	expect(buildConfig({ TRUST_PROXY: "" }).trustProxy).toBe(false);
	expect(() => buildConfig({ TRUST_PROXY: "yes" })).toThrow(
		"TRUST_PROXY must be true or false",
	);
});

// An empty variable (set to nothing) is the same as one that is not set, so it takes the default. Read as a number it
// would be 0, which is a different setting.
describe("an empty value is the same as an unset one", () => {
	it("takes the default for a whole number, a share and the port", () => {
		const config = buildConfig({
			ADMISSION_TICK_MS: "",
			PAYMENT_LATENCY_MS: "",
			PAYMENT_FAILURE_RATE: "",
			FLASH_BE_PORT: "",
		});
		expect(config.admissionTickMs).toBe(1000);
		expect(config.paymentLatencyMs).toBe(150);
		expect(config.paymentFailureRate).toBeCloseTo(0.02);
		expect(config.port).toBe(Number(localDefaults.port));
	});

	it("takes the default host", () => {
		expect(buildConfig({ FLASH_BE_HOST: "" }).host).toBe(localDefaults.host);
	});
});

describe("the cookies of a login", () => {
	it("are for HTTPS only in production, and for plain HTTP otherwise", () => {
		expect(buildConfig({}).cookieSecure).toBe(false);
		expect(
			buildConfig({
				NODE_ENV: "production",
				DATABASE_URL: "postgres://db/flash",
				REDIS_URL: "redis://cache",
				TICKET_SECRET: "a-long-random-ticket-secret",
			}).cookieSecure,
		).toBe(true);
	});

	it("can be set by COOKIE_SECURE, and refuse a value that is not true or false", () => {
		expect(buildConfig({ COOKIE_SECURE: "true" }).cookieSecure).toBe(true);
		expect(
			buildConfig({
				NODE_ENV: "production",
				DATABASE_URL: "postgres://db/flash",
				REDIS_URL: "redis://cache",
				TICKET_SECRET: "a-long-random-ticket-secret",
				COOKIE_SECURE: "false",
			}).cookieSecure,
		).toBe(false);
		expect(() => buildConfig({ COOKIE_SECURE: "yes" })).toThrow(
			"COOKIE_SECURE must be true or false",
		);
	});

	it("shows in the startup log line", () => {
		expect(configFields(buildConfig({})).cookieSecure).toBe(false);
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

	it("has no admin token any more: operators log in", () => {
		expect(example).not.toHaveProperty("ADMIN_TOKEN");
	});
});
