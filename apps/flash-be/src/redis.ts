import { createClient } from "redis";

export async function createRedis(url: string) {
	const client = createClient({ url });
	// Without a listener, a dropped socket emits an unhandled 'error' and exits the process.
	// The client reconnects on its own.
	client.on("error", (err) => console.error("redis:", err.message));
	await client.connect();
	return client;
}

export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
