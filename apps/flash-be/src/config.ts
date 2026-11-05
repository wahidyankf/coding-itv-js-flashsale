export type Config = {
	host: string;
	port: number;
	databaseUrl: string;
	redisUrl: string;
};

const localDefaults = {
	host: "0.0.0.0",
	port: "8080",
	databaseUrl: "postgres://flash:flash@localhost:5432/flash",
	redisUrl: "redis://localhost:6379",
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

	return {
		host: env.FLASH_BE_HOST ?? localDefaults.host,
		port,
		databaseUrl: withDefault("DATABASE_URL", localDefaults.databaseUrl),
		redisUrl: withDefault("REDIS_URL", localDefaults.redisUrl),
	};
}

export const config = buildConfig(process.env);
