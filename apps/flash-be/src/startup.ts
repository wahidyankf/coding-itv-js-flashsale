// The first steps of the server process, run by main.ts before the app exists: write the config line, then connect to
// Redis. The line comes first, so an API whose start waits on an unreachable Redis still says what it tries to reach.
import type { Logger } from "./application/ports/logger.js";
import { type Config, configFields } from "./config.js";

// Writes the config line, then connects to Redis and returns the client. `connect` is the Redis adapter in main.ts and a
// fake in the tests, which check the order.
export async function announceThenConnect<Client>(
	config: Config,
	log: Pick<Logger, "info">,
	connect: (url: string) => Promise<Client>,
): Promise<Client> {
	log.info(configFields(config), "flash-be config");
	return connect(config.redisUrl);
}
