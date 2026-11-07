// The readiness check of Redis, the fast gate (outbound Redis adapter). `/ready` reports it, through the dependency the
// composition wires. A PING is the question "does Redis answer", and the client fails it at once while the link is down.
import type { RedisClient } from "./redis-client.js";

// Resolves when Redis answers, and rejects when the command fails.
export async function checkGate(redis: RedisClient): Promise<void> {
	await redis.ping();
}
