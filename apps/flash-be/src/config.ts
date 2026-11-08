// Configuration: the settings of the server, read from the environment and checked. It sits outside the hexagon. The
// entry points and the integration tests read `config`; the rest of the code takes its settings as arguments. A missing
// setting takes its default; a wrong one stops the start with a message that names it. The variables are in .env.example.
import { localDefaults } from "./local-defaults.js";

// The levels pino knows, from the most to the least severe. `silent` writes nothing.
export const LOG_LEVELS = [
	"fatal",
	"error",
	"warn",
	"info",
	"debug",
	"trace",
	"silent",
] as const;

// How much the server writes to its log: the lines at this level and the more severe ones.
export type LogLevel = (typeof LOG_LEVELS)[number];

// The settings of the server, each named after the environment variable that sets it.
export type Config = {
	// The address and port the HTTP server listens on.
	host: string;
	port: number;
	// Postgres and Redis addresses. They keep their credentials, so the startup line shows only host and port.
	databaseUrl: string;
	redisUrl: string;
	// Signs the queue tickets. Every instance must share it.
	ticketSecret: string;
	// How often the queue admits the next shoppers, and how long an admission stays valid.
	admissionTickMs: number;
	admissionTtlSeconds: number;
	// The mock payment provider: how long a charge takes, and the share of charges it declines (0 to 1).
	paymentLatencyMs: number;
	paymentFailureRate: number;
	// Write requests allowed per user and per address in each window. See application/rate-limiter.ts.
	rateLimitWindowSeconds: number;
	rateLimitPerUser: number;
	rateLimitPerIp: number;
	authRateLimitPerIp: number;
	// How long a sale read may be served from memory. 0 turns the cache off. See application/sale-cache.ts.
	saleCacheMs: number;
	// How often an open event stream reads the sale or the place, in milliseconds.
	eventsIntervalMs: number;
	// True only behind a proxy you control, so request.ip comes from X-Forwarded-For.
	trustProxy: boolean;
	// Whether the login cookies are sent over HTTPS only. On in production; turn it off only for plain HTTP.
	cookieSecure: boolean;
	// After a stop signal: how long the server keeps answering while readiness says 503, and the longest the whole
	// shutdown may take before the process exits with a failure. See shutdown.ts.
	shutdownDrainMs: number;
	shutdownTimeoutMs: number;
	// How much the server logs. `info` keeps one line per request and the events an operator acts on.
	logLevel: LogLevel;
};

// The highest port number a TCP address can have.
const MAX_PORT = 65535;

// The default of each setting that has one. They are the values in .env.example and in the docs; a test checks them.
const settingDefaults = {
	admissionTickMs: 1000,
	admissionTtlSeconds: 600,
	paymentLatencyMs: 150,
	paymentFailureRate: 0.02,
	rateLimitWindowSeconds: 10,
	rateLimitPerUser: 30,
	rateLimitPerIp: 600,
	authRateLimitPerIp: 20,
	saleCacheMs: 1000,
	eventsIntervalMs: 1000,
	// Long enough for a monitor that checks /ready every second to see the 503, and for kept-alive connections to close.
	shutdownDrainMs: 2000,
	// The drain window, the requests in flight and the closing of the stores, well before Docker's kill.
	shutdownTimeoutMs: 10_000,
} as const;

// The text of a setting, or undefined when it is not set. An empty variable counts as not set, so it takes the default.
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const value = env[name];
	return value === undefined || value === "" ? undefined : value;
}

// The readers of one environment. Each takes a setting by name, reads it, and refuses a value that breaks its rule.
function readersOf(env: NodeJS.ProcessEnv) {
	// A whole number that is at least `min`. The error names the rule, so the fix is clear.
	const integerAtLeast = (
		name: string,
		fallback: number,
		min: 0 | 1,
	): number => {
		const value = Number(setting(env, name) ?? fallback);
		if (!Number.isInteger(value) || value < min) {
			const rule =
				min === 0 ? "zero or a positive integer" : "a positive integer";
			throw new Error(`${name} must be ${rule}`);
		}
		return value;
	};

	// A number from 0 to 1, such as a share of charges.
	const fraction = (name: string, fallback: number): number => {
		const value = Number(setting(env, name) ?? fallback);
		if (!Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error(`${name} must be a number from 0 to 1`);
		}
		return value;
	};

	// A switch that is `true` or `false`. An empty value takes the default; anything else is refused.
	const flag = (name: string, fallback: boolean): boolean => {
		const value = env[name];
		if (value === undefined || value === "") return fallback;
		if (value !== "true" && value !== "false") {
			throw new Error(`${name} must be true or false`);
		}
		return value === "true";
	};

	// One word from a fixed list. The error lists the words, so the fix is clear.
	const oneOf = <const T extends string>(
		name: string,
		words: readonly T[],
		fallback: T,
	): T => {
		const value = setting(env, name) ?? fallback;
		const word = words.find((candidate) => candidate === value);
		if (word === undefined) {
			throw new Error(`${name} must be one of ${words.join(", ")}`);
		}
		return word;
	};

	return { integerAtLeast, fraction, flag, oneOf };
}

// The drain window and the time limit of a shutdown. A limit that the drain window alone uses up would fail every
// shutdown, so it is refused.
function shutdownSettings(
	integerAtLeast: ReturnType<typeof readersOf>["integerAtLeast"],
): Pick<Config, "shutdownDrainMs" | "shutdownTimeoutMs"> {
	const shutdownDrainMs = integerAtLeast(
		"SHUTDOWN_DRAIN_MS",
		settingDefaults.shutdownDrainMs,
		0,
	);
	const shutdownTimeoutMs = integerAtLeast(
		"SHUTDOWN_TIMEOUT_MS",
		settingDefaults.shutdownTimeoutMs,
		1,
	);
	if (shutdownTimeoutMs <= shutdownDrainMs) {
		throw new Error(
			"SHUTDOWN_TIMEOUT_MS must be greater than SHUTDOWN_DRAIN_MS",
		);
	}
	return { shutdownDrainMs, shutdownTimeoutMs };
}

// Reads every setting from the environment. Local defaults match compose.dev.yaml. In production the URLs and the ticket
// secret must come from the environment, so a missing one stops the start.
export function buildConfig(env: NodeJS.ProcessEnv): Config {
	const isProduction = env.NODE_ENV === "production";
	const { integerAtLeast, fraction, flag, oneOf } = readersOf(env);

	const withDefault = (name: string, fallback: string): string => {
		const value = env[name];
		if (value) return value;
		if (isProduction) throw new Error(`${name} is required in production`);
		return fallback;
	};

	const port = Number(setting(env, "FLASH_BE_PORT") ?? localDefaults.port);
	if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
		throw new Error("FLASH_BE_PORT must be a valid port number");
	}

	return {
		host: setting(env, "FLASH_BE_HOST") ?? localDefaults.host,
		port,
		databaseUrl: withDefault("DATABASE_URL", localDefaults.databaseUrl),
		redisUrl: withDefault("REDIS_URL", localDefaults.redisUrl),
		ticketSecret: withDefault("TICKET_SECRET", localDefaults.ticketSecret),
		admissionTickMs: integerAtLeast(
			"ADMISSION_TICK_MS",
			settingDefaults.admissionTickMs,
			1,
		),
		admissionTtlSeconds: integerAtLeast(
			"ADMISSION_TTL_SECONDS",
			settingDefaults.admissionTtlSeconds,
			1,
		),
		paymentLatencyMs: integerAtLeast(
			"PAYMENT_LATENCY_MS",
			settingDefaults.paymentLatencyMs,
			0,
		),
		paymentFailureRate: fraction(
			"PAYMENT_FAILURE_RATE",
			settingDefaults.paymentFailureRate,
		),
		rateLimitWindowSeconds: integerAtLeast(
			"RATE_LIMIT_WINDOW_SECONDS",
			settingDefaults.rateLimitWindowSeconds,
			1,
		),
		rateLimitPerUser: integerAtLeast(
			"RATE_LIMIT_PER_USER",
			settingDefaults.rateLimitPerUser,
			1,
		),
		rateLimitPerIp: integerAtLeast(
			"RATE_LIMIT_PER_IP",
			settingDefaults.rateLimitPerIp,
			1,
		),
		authRateLimitPerIp: integerAtLeast(
			"AUTH_RATE_LIMIT_PER_IP",
			settingDefaults.authRateLimitPerIp,
			1,
		),
		saleCacheMs: integerAtLeast(
			"SALE_CACHE_MS",
			settingDefaults.saleCacheMs,
			0,
		),
		eventsIntervalMs: integerAtLeast(
			"EVENTS_INTERVAL_MS",
			settingDefaults.eventsIntervalMs,
			1,
		),
		trustProxy: flag("TRUST_PROXY", false),
		cookieSecure: flag("COOKIE_SECURE", isProduction),
		...shutdownSettings(integerAtLeast),
		logLevel: oneOf("LOG_LEVEL", LOG_LEVELS, "info"),
	};
}

// The fields of the startup log line: the settings that matter for a run, with the host and port of each address only.
// Credentials and the ticket secret stay out of the log.
export function configFields(config: Config) {
	const endpoint = (url: string): string => {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port}`;
	};
	return {
		port: config.port,
		database: endpoint(config.databaseUrl),
		redis: endpoint(config.redisUrl),
		paymentLatencyMs: config.paymentLatencyMs,
		paymentFailureRate: config.paymentFailureRate,
		rateLimitPerUser: config.rateLimitPerUser,
		rateLimitPerIp: config.rateLimitPerIp,
		rateLimitWindowSeconds: config.rateLimitWindowSeconds,
		saleCacheMs: config.saleCacheMs,
		eventsIntervalMs: config.eventsIntervalMs,
		trustProxy: config.trustProxy,
		cookieSecure: config.cookieSecure,
		shutdownDrainMs: config.shutdownDrainMs,
		shutdownTimeoutMs: config.shutdownTimeoutMs,
		logLevel: config.logLevel,
	};
}

// The settings of this process, read once when the module loads. The entry points and the integration tests use it.
export const config = buildConfig(process.env);
