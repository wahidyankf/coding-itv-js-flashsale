// Entry point (the outermost layer): the server. It reads the configuration, opens Postgres and Redis, builds the
// dependencies, starts the HTTP app, and runs the admission timer on every instance. The queue store lets one of them win
// each tick. A stop signal runs the shutdown in shutdown.ts.
import { attemptAsync } from "@flash/typekit";
import { buildApp, createLogger } from "./adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "./adapters/inbound/http/event-stream.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { createRedis } from "./adapters/outbound/redis/redis-client.js";
import { admitCurrentSale } from "./application/admission.js";
import type { Logger } from "./application/ports/logger.js";
import { dependenciesFrom } from "./composition.js";
import { config } from "./config.js";
import { createShutdown, systemTimers } from "./shutdown.js";
import { announceThenConnect } from "./startup.js";

// The one log of the process, made first so the config line and a Redis that cannot be reached are told before anything
// waits. The app writes through the same instance.
const logger = createLogger({ level: config.logLevel });
const log: Logger = {
	debug: (fields, message) => logger.debug(fields, message),
	info: (fields, message) => logger.info(fields, message),
	warn: (fields, message) => logger.warn(fields, message),
	error: (fields, message) => logger.error(fields, message),
};

const db = createDb(config.databaseUrl);
const redis = await announceThenConnect(config, log, (url) =>
	createRedis(url, log),
);
const deps = dependenciesFrom(db, redis, { ...config, log });
// Set by the first stop signal. Readiness answers 503 from then on.
let stopping = false;
const app = buildApp(deps, {
	logger,
	trustProxy: config.trustProxy,
	cookieSecure: config.cookieSecure,
	events: { ...DEFAULT_STREAM_OPTIONS, intervalMs: config.eventsIntervalMs },
	isStopping: () => stopping,
});

// Runs on every instance, so the line still moves when one instance is down.
const admitter = setInterval(async () => {
	const ticked = await attemptAsync(
		() => admitCurrentSale(deps.sales, deps.queue),
		Error,
	);
	if (ticked.isErr()) {
		app.log.error({ err: ticked.error }, "admission tick failed");
	}
}, config.admissionTickMs);

// Readiness turns to 503 and the admitter stops at once; the server keeps answering through the drain window. Then the
// HTTP server closes (it ends the event streams and waits for the requests in flight), and the stores close after it.
const shutdown = createShutdown({
	stopTaking: () => {
		stopping = true;
		clearInterval(admitter);
	},
	drainMs: config.shutdownDrainMs,
	timeoutMs: config.shutdownTimeoutMs,
	steps: [
		{ name: "the HTTP server", close: () => app.close() },
		{ name: "Redis", close: () => redis.close() },
		{ name: "Postgres", close: () => db.destroy() },
	],
	timers: systemTimers,
	log: {
		info: (message) => app.log.info(message),
		error: (error, message) => app.log.error({ err: error }, message),
	},
	exit: (code) => process.exit(code),
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
