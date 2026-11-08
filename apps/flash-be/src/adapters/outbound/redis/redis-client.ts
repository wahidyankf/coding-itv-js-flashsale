// The one Redis connection of the process, made with node-redis. Outbound Redis adapter: the other Redis adapters take the
// client it returns, so they never open a connection of their own. The client reconnects with backoff and full jitter,
// and it never gives up (decision 017).
import { type BackoffPolicy, backoffDelayMs } from "@flash/flash-commons";
import { createClient } from "redis";
import type { Logger } from "../../../application/ports/logger.js";

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
// down, and it reconnects by itself. With a `log`, the connection is watched from before the first connect, so a start
// that waits on an unreachable Redis says so.
export async function createRedis(url: string, log?: Logger) {
	// Commands fail at once while the connection is down, instead of waiting in a queue. The callers have a way
	// to serve without Redis, and a request must not hang until it comes back.
	const client = createClient({
		url,
		disableOfflineQueue: true,
		socket: { reconnectStrategy: reconnectStrategy(Math.random) },
	});
	// Without a listener, a dropped socket emits an unhandled 'error' and exits the process. The client reconnects on its
	// own, and watchConnection logs the change, once.
	client.on("error", () => {});
	if (log !== undefined) watchConnection(client, log);
	await client.connect();
	return client;
}

// Where the client tells of its connection: an 'error' for each failure, and 'ready' each time it is connected again.
type ConnectionEvents = {
	on: (
		event: "error" | "ready",
		listener: (cause?: unknown) => void,
	) => unknown;
};

// Logs the moment the connection is lost (warn) and the moment it is back (info), once per change. While it is down every
// command fails at once, and a line for each would bury the change an operator looks for. Watched from before the first
// connect, a first connect that fails is told as Redis not reachable; a first connect that works writes nothing.
export function watchConnection(client: ConnectionEvents, log: Logger): void {
	let state: "starting" | "up" | "down" = "starting";
	client.on("error", (cause) => {
		if (state === "down") return;
		const text = cause instanceof Error ? cause.message : String(cause);
		const message =
			state === "starting"
				? "redis not reachable, retrying"
				: "redis connection lost";
		state = "down";
		log.warn({ cause: text }, message);
	});
	client.on("ready", () => {
		if (state === "down") log.info({}, "redis connection back");
		state = "up";
	});
}

// The client type the Redis adapters take, so none of them depends on how the client is built.
export type RedisClient = Awaited<ReturnType<typeof createRedis>>;
