// Entry point (the outermost layer): the server. It reads the configuration, opens Postgres and Redis, builds the
// dependencies, starts the HTTP app, and runs the admission timer on every instance. The queue store lets one of them win
// each tick.
import { attemptAsync } from "@flash/typekit";
import { buildApp } from "./adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "./adapters/inbound/http/event-stream.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { createRedis } from "./adapters/outbound/redis/redis-client.js";
import { admitCurrentSale } from "./application/admission.js";
import { dependenciesFrom } from "./composition.js";
import { config, describeConfig } from "./config.js";

console.log(describeConfig(config));

const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const deps = dependenciesFrom(db, redis, config);
const app = buildApp(deps, {
	logger: true,
	trustProxy: config.trustProxy,
	cookieSecure: config.cookieSecure,
	events: { ...DEFAULT_STREAM_OPTIONS, intervalMs: config.eventsIntervalMs },
});

// Admits the next shoppers of the current sale. Every instance runs this; the store lets one win each tick.
const admitter = setInterval(async () => {
	const ticked = await attemptAsync(
		() => admitCurrentSale(deps.sales, deps.queue),
		Error,
	);
	if (ticked.isErr()) {
		app.log.error({ err: ticked.error }, "admission tick failed");
	}
}, config.admissionTickMs);

const shutdown = async (): Promise<void> => {
	clearInterval(admitter);
	await app.close();
	await redis.close();
	await db.destroy();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
