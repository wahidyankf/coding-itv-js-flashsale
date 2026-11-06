export type Config = {
	host: string;
	port: number;
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
	// Write requests allowed per user and per address in each window. See ratelimit/.
	rateLimitWindowSeconds: number;
	rateLimitPerUser: number;
	rateLimitPerIp: number;
	// How long a sale read may be served from memory. 0 turns the cache off. See sales/sale-cache.ts.
	saleCacheMs: number;
	// How often an open event stream reads the sale or the place, in milliseconds.
	eventsIntervalMs: number;
	// True only behind a proxy you control, so request.ip comes from X-Forwarded-For.
	trustProxy: boolean;
	// The operator's token for the admin routes. Without it they are off.
	adminToken: string | undefined;
};

const ADMIN_TOKEN_MIN_LENGTH = 16;

const localDefaults = {
	host: "::",
	port: "8080",
	databaseUrl: "postgres://flash:flash@localhost:5432/flash",
	redisUrl: "redis://localhost:6379",
	ticketSecret: "local-development-ticket-secret",
};

// Local defaults match compose.dev.yaml. In production, the URLs must come from the environment.
export function buildConfig(env: NodeJS.ProcessEnv): Config {
	const isProduction = env.NODE_ENV === "production";

	const withDefault = (name: string, fallback: string): string => {
		const value = env[name];
		if (value) return value;
		if (isProduction) throw new Error(`${name} is required in production`);
		return fallback;
	};

	const port = Number(env.FLASH_BE_PORT ?? localDefaults.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("FLASH_BE_PORT must be a valid port number");
	}

	const positive = (name: string, fallback: number): number => {
		const value = Number(env[name] ?? fallback);
		if (!Number.isInteger(value) || value < 1) {
			throw new Error(`${name} must be a positive integer`);
		}
		return value;
	};

	const rate = (name: string, fallback: number): number => {
		const value = Number(env[name] ?? fallback);
		if (!Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error(`${name} must be a number from 0 to 1`);
		}
		return value;
	};

	const flag = (name: string, fallback: boolean): boolean => {
		const value = env[name];
		if (value === undefined || value === "") return fallback;
		if (value !== "true" && value !== "false") {
			throw new Error(`${name} must be true or false`);
		}
		return value === "true";
	};

	const latency = (name: string, fallback: number): number => {
		const value = Number(env[name] ?? fallback);
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`${name} must be zero or a positive integer`);
		}
		return value;
	};

	const adminToken = ((): string | undefined => {
		const value = env.ADMIN_TOKEN;
		if (value === undefined || value === "") return undefined;
		if (value.length < ADMIN_TOKEN_MIN_LENGTH) {
			throw new Error(
				`ADMIN_TOKEN must be at least ${ADMIN_TOKEN_MIN_LENGTH} characters`,
			);
		}
		return value;
	})();

	return {
		host: env.FLASH_BE_HOST ?? localDefaults.host,
		port,
		databaseUrl: withDefault("DATABASE_URL", localDefaults.databaseUrl),
		redisUrl: withDefault("REDIS_URL", localDefaults.redisUrl),
		ticketSecret: withDefault("TICKET_SECRET", localDefaults.ticketSecret),
		admissionTickMs: positive("ADMISSION_TICK_MS", 1000),
		admissionTtlSeconds: positive("ADMISSION_TTL_SECONDS", 600),
		paymentLatencyMs: latency("PAYMENT_LATENCY_MS", 150),
		paymentFailureRate: rate("PAYMENT_FAILURE_RATE", 0.02),
		rateLimitWindowSeconds: positive("RATE_LIMIT_WINDOW_SECONDS", 10),
		rateLimitPerUser: positive("RATE_LIMIT_PER_USER", 30),
		rateLimitPerIp: positive("RATE_LIMIT_PER_IP", 600),
		saleCacheMs: latency("SALE_CACHE_MS", 1000),
		eventsIntervalMs: positive("EVENTS_INTERVAL_MS", 1000),
		trustProxy: flag("TRUST_PROXY", false),
		adminToken,
	};
}

// Startup log line: the effective settings, host and port only. Credentials stay out of the log.
export function describeConfig(config: Config): string {
	const endpoint = (url: string): string => {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port}`;
	};
	return `flash-be config: port=${config.port} database=${endpoint(config.databaseUrl)} redis=${endpoint(config.redisUrl)} payment=${config.paymentLatencyMs}ms/${config.paymentFailureRate} limit=${config.rateLimitPerUser}/${config.rateLimitPerIp}/${config.rateLimitWindowSeconds}s cache=${config.saleCacheMs}ms events=${config.eventsIntervalMs}ms proxy=${config.trustProxy} admin=${config.adminToken === undefined ? "off" : "on"}`;
}

export const config = buildConfig(process.env);
