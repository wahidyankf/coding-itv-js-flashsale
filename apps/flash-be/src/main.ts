import { buildApp, dependenciesFrom } from "./app.js";
import { config, describeConfig } from "./config.js";
import { createDb } from "./db.js";
import { createRedis } from "./redis.js";

console.log(describeConfig(config));

const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const app = buildApp(dependenciesFrom(db, redis), { logger: true });

const shutdown = async (): Promise<void> => {
	await app.close();
	await redis.close();
	await db.destroy();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
