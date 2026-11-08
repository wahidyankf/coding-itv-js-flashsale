// The one Redis connection of the process, made with node-redis. Outbound Redis adapter: the other Redis adapters take the
// client it returns, so they never open a connection of their own. The client reconnects with backoff and full jitter,
// and it never gives up (decision 017).
import { type BackoffPolicy, backoffDelayMs } from "@flash/flash-commons";
import { createClient } from "redis";

// How the reconnect wait grows: from a small base, doubling, up to a cap (decision 017).
const RECONNECT_POLICY: BackoffPolicy = { baseMs: 50, capMs: 2000 };

// The wait before reconnect try `retries` (0 for the first try after the drop). Jitter spreads the clients out when
// Redis returns, so they do not all reconnect at once.
export function reconnectDelayMs(
	retries: number,
	random: () => number,
): number {
	return backoffDelayMs(retries, RECONNECT_POLICY, random);
}

// The strategy node-redis calls after the socket closes. It always answers with a wait. The node-redis default answers
// `false` after a socket timeout, so the client would never reconnect. There is no max attempt count, on purpose: the
// API must catch up when Redis returns (decision 003).
export function reconnectStrategy(random: () => number) {
	return (retries: number, _cause: Error): number =>
		reconnectDelayMs(retries, random);
}

// Connects to Redis at `url` and returns the client. The client fails each command at once while the connection is
// down, and it reconnects by itself.
export async function createRedis(url: string) {
	// Commands fail at once while the connection is down, instead of waiting in a queue. The callers have a way
	// to serve without Redis, and a request must not hang until it comes back.
	const client = createClient({
		url,
		disableOfflineQueue: true,
		socket: { reconnectStrategy: reconnectStrategy(Math.random) },
	});
	// Without a listener, a dropped socket emits an unhandled 'error' and exits the process.
	// The client reconnects on its own.
	client.on("error", (err) => console.error("redis:", err.message));
	await client.connect();
	return client;
}

// The client type the Redis adapters take, so none of them depends on how the client is built.
export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
