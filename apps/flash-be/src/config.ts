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
};

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

	const latency = (name: string, fallback: number): number => {
		const value = Number(env[name] ?? fallback);
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`${name} must be zero or a positive integer`);
		}
		return value;
	};

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
	};
}

// Startup log line: the effective settings, host and port only. Credentials stay out of the log.
export function describeConfig(config: Config): string {
	const endpoint = (url: string): string => {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port}`;
	};
	return `flash-be config: port=${config.port} database=${endpoint(config.databaseUrl)} redis=${endpoint(config.redisUrl)} payment=${config.paymentLatencyMs}ms/${config.paymentFailureRate}`;
}

export const config = buildConfig(process.env);
