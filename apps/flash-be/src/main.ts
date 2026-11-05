import { attemptAsync } from "@flash/typekit";
import { buildApp } from "./adapters/inbound/http/app.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { createRedis } from "./adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "./composition.js";
import { config, describeConfig } from "./config.js";

console.log(describeConfig(config));

const db = createDb(config.databaseUrl);
const redis = await createRedis(config.redisUrl);
const deps = dependenciesFrom(db, redis, config);
const app = buildApp(deps, {
	logger: true,
	trustProxy: config.trustProxy,
	events: { intervalMs: config.eventsIntervalMs, heartbeatMs: 15_000 },
});

// Admits the next shoppers of the current sale. Every instance runs this; the store lets one win each tick.
const admitter = setInterval(async () => {
	const ticked = await attemptAsync(async () => {
		const sale = await deps.sales.current();
		if (sale) await deps.queue.admitTick(sale.value.id);
	}, Error);
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
