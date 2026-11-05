import { createClient } from "redis";

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

export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
