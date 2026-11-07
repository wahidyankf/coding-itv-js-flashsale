// The one Redis connection of the process, made with node-redis. Outbound Redis adapter: the other Redis adapters take the
// client it returns, so they never open a connection of their own. The client reconnects with backoff and full jitter,
// and it never gives up (decision 017).
import { type BackoffPolicy, backoffDelayMs } from "@flash/flash-commons";
import { createClient } from "redis";

// The reconnect wait: full jitter under a bound that starts at 50 ms, doubles, and stops at 2 s.
const RECONNECT_POLICY: BackoffPolicy = { baseMs: 50, capMs: 2000 };

// The wait before reconnect try `retries` (0 for the first try after the drop). The jitter spreads a crowd of clients
// out when Redis comes back, so they do not all reconnect in the same instant.
export function reconnectDelayMs(
	retries: number,
	random: () => number,
): number {
	return backoffDelayMs(retries, RECONNECT_POLICY, random);
}

// The strategy node-redis calls after the socket closes. It answers a wait for every cause, a socket timeout included:
// the node-redis default answers `false` after a timeout and never reconnects, so the API would stay without Redis until
// it restarted. There is no max attempt count, on purpose: the API must catch up when Redis returns (decision 003), and
// a client that gave up would need a restart to serve from Redis again.
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

// The type of the connected client that `createRedis` returns.
export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
