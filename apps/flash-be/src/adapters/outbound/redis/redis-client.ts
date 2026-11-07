// The one Redis connection of the process, made with node-redis. Outbound Redis adapter: the other Redis adapters take the
// client it returns, so they never open a connection of their own.
import { createClient } from "redis";

// Connects to Redis at `url` and returns the client. The client fails each command at once while the connection is
// down, and it reconnects by itself.
export async function createRedis(url: string) {
	// Commands fail at once while the connection is down, instead of waiting in a queue. The callers have a way
	// to serve without Redis, and a request must not hang until it comes back.
	const client = createClient({ url, disableOfflineQueue: true });
	// Without a listener, a dropped socket emits an unhandled 'error' and exits the process.
	// The client reconnects on its own.
	client.on("error", (err) => console.error("redis:", err.message));
	await client.connect();
	return client;
}

// The type of the connected client that `createRedis` returns.
export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
