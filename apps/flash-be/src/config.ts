// Configuration: the settings of the server, read from the environment and checked. It sits outside the hexagon. The
// entry points and the integration tests read `config`; the rest of the code takes its settings as arguments. A missing
// setting takes its default; a wrong one stops the start with a message that names it. The variables are in .env.example.
import { localDefaults } from "./local-defaults.js";

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
};

// The highest port number a TCP address can have.
const MAX_PORT = 65535;

// The default of each setting that has one. They are the values in .env.example and in the docs; a test holds them.
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
} as const;

// The text of a setting, or undefined when it is not set. An empty variable counts as not set, so it takes the default.
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const value = env[name];
	return value === undefined || value === "" ? undefined : value;
}

// The readers of one environment. Each takes a setting by name, reads it, and refuses a value that breaks its rule.
function readersOf(env: NodeJS.ProcessEnv) {
	// A whole number that is at least `min`. The error says the rule, so a bad value says what it needed.
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

	return { integerAtLeast, fraction, flag };
}

// Reads every setting from the environment. Local defaults match compose.dev.yaml. In production the URLs and the ticket
// secret must come from the environment, so a missing one stops the start.
export function buildConfig(env: NodeJS.ProcessEnv): Config {
	const isProduction = env.NODE_ENV === "production";
	const { integerAtLeast, fraction, flag } = readersOf(env);

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
	};
}

// The startup line: the settings that matter for a run, with the host and port of each address only. Credentials stay
// out of the log.
export function describeConfig(config: Config): string {
	const endpoint = (url: string): string => {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port}`;
	};
	const parts = [
		`port=${config.port}`,
		`database=${endpoint(config.databaseUrl)}`,
		`redis=${endpoint(config.redisUrl)}`,
		`payment=${config.paymentLatencyMs}ms/${config.paymentFailureRate}`,
		`limit=${config.rateLimitPerUser}/${config.rateLimitPerIp}/${config.rateLimitWindowSeconds}s`,
		`cache=${config.saleCacheMs}ms`,
		`events=${config.eventsIntervalMs}ms`,
		`proxy=${config.trustProxy}`,
		`secureCookies=${config.cookieSecure}`,
	];
	return `flash-be config: ${parts.join(" ")}`;
}

// The settings of this process, read once when the module loads. The entry points and the integration tests use it.
export const config = buildConfig(process.env);
